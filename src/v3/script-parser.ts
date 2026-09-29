/**
 * Script Parser and Validator for v3 Scene JSON.
 * Checks for hard errors defined in Section 6 of Architecture Spec.
 */

import type { V3Scene, V3Step, MemorySpaces } from './types';

export interface ValidationIssue {
  type: 'error' | 'warning';
  stepId?: string;
  rule: number;
  message: string;
}

// Firmware 1.0.0 contract: replies a touch layout can actually emit.
const TOUCH_ZONE_MAX: Record<string, number> = { tb2: 2, lr2: 2, pie3: 3, pie4: 4 };
const TOUCH_BASE_REPLIES = new Set(['miss', 'silent']);
const SWIPE_REPLIES = new Set([
  'swipe_up',
  'swipe_down',
  'swipe_left',
  'swipe_right',
  'miss',
  'silent',
]);
const VOICE_SYSTEM_REPLIES = new Set(['other', 'unclear', 'silent', 'spoke']);
// Old authoring tokens the device never emits.
const BANNED_REPLY_TOKENS = new Set([
  'cham_khac',
  'vuot_len',
  'vuot_xuong',
  'vuot_trai',
  'vuot_phai',
  'zone5',
  'zone6',
  'zone7',
  'zone8',
]);
const PLACEHOLDER_RE = /\{[^{}]*\}/;

export function validateV3Scene(scene: unknown): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  if (!scene || typeof scene !== 'object') {
    return {
      valid: false,
      issues: [{ type: 'error', rule: 1, message: 'Kịch bản phải là một JSON object hợp lệ.' }],
    };
  }

  const s = scene as Partial<V3Scene>;

  // Rule 1: Scene required fields
  if (!s.id) issues.push({ type: 'error', rule: 1, message: 'Thiếu trường "id" của kịch bản.' });
  if (!s.entry) issues.push({ type: 'error', rule: 1, message: 'Thiếu trường "entry" (step bắt đầu).' });
  if (!Array.isArray(s.steps) || s.steps.length === 0) {
    issues.push({ type: 'error', rule: 1, message: 'Danh sách "steps" rỗng hoặc không phải mảng.' });
    return { valid: false, issues };
  }

  // Check entry step exists
  const stepIds = new Set<string>();
  for (const step of s.steps) {
    if (!step.id) {
      issues.push({ type: 'error', rule: 2, message: 'Có step thiếu trường "id".' });
      continue;
    }
    if (stepIds.has(step.id)) {
      issues.push({ type: 'error', rule: 2, stepId: step.id, message: `Trùng lặp step id: "${step.id}".` });
    }
    stepIds.add(step.id);
  }

  if (s.entry && !stepIds.has(s.entry)) {
    issues.push({
      type: 'error',
      rule: 1,
      message: `Step bắt đầu "entry": "${s.entry}" không tồn tại trong danh sách steps.`,
    });
  }

  // Check each step
  for (const step of s.steps) {
    validateStep(step, issues, stepIds, s.prompts);
  }

  const hasErrors = issues.some((i) => i.type === 'error');
  return { valid: !hasErrors, issues };
}

function validateStep(
  step: V3Step,
  issues: ValidationIssue[],
  allStepIds: Set<string>,
  prompts?: Record<string, string>,
): void {
  // Rule 2: Conflict between branches and next
  if (step.branches && step.next) {
    issues.push({
      type: 'error',
      rule: 2,
      stepId: step.id,
      message: `Step "${step.id}" không được đồng thời chứa cả "branches" và "next".`,
    });
  }

  // Rule 2: Listen requires branches
  if (step.listen && step.listen.mode !== 'none' && !step.branches) {
    issues.push({
      type: 'error',
      rule: 2,
      stepId: step.id,
      message: `Step "${step.id}" có listen mode "${step.listen.mode}" nhưng thiếu "branches".`,
    });
  }

  // Rule 8: Branches must have default at the end
  if (step.branches && step.branches.length > 0) {
    const lastBranch = step.branches[step.branches.length - 1];
    const hasDefaultAtEnd =
      lastBranch.when === 'default' ||
      (typeof lastBranch.when === 'object' && Object.keys(lastBranch.when).length === 0) ||
      lastBranch.when === undefined;

    if (!hasDefaultAtEnd) {
      issues.push({
        type: 'error',
        rule: 8,
        stepId: step.id,
        message: `Step "${step.id}": Nhánh rẽ cuối cùng trong branches bắt buộc phải là "default".`,
      });
    }

    // Check branch targets exist if within same scene
    for (const b of step.branches) {
      const target = b.go || b.next;
      if (target && !target.includes('#') && !target.startsWith('{') && !allStepIds.has(target)) {
        issues.push({
          type: 'warning',
          rule: 8,
          stepId: step.id,
          message: `Nhánh trỏ tới step "${target}" không tìm thấy trong kịch bản hiện tại.`,
        });
      }
    }
  }

  // Rule 6: Ban {nbest} placeholder
  const rawStepStr = JSON.stringify(step);
  if (rawStepStr.includes('{nbest}')) {
    issues.push({
      type: 'error',
      rule: 6,
      stepId: step.id,
      message: `Phát hiện placeholder bị cấm "{nbest}" (đã bị khai tử trong chuẩn v3).`,
    });
  }

  // Step id charset: lowercase letters, digits, underscore only
  if (step.id && !/^[a-z0-9_]+$/.test(step.id)) {
    issues.push({
      type: 'error',
      rule: 2,
      stepId: step.id,
      message: `Step id "${step.id}" chỉ được chứa chữ thường, số và "_".`,
    });
  }

  validateNodes(step, issues);
  validateListen(step, issues, prompts);

  // save write-guard: sys.*/profile.* are read-only
  for (const key of Object.keys(step.save || {})) {
    if (key.startsWith('sys.') || key.startsWith('profile.')) {
      issues.push({
        type: 'error',
        rule: 8,
        stepId: step.id,
        message: `save ghi vào "${key}" — sys.*/profile.* là read-only.`,
      });
    }
  }
}

/** Node url + visual timing rules (firmware 1.0.0). */
function validateNodes(step: V3Step, issues: ValidationIssue[]): void {
  const lanes: Array<'audio' | 'visual'> = ['audio', 'visual'];
  const groups: Array<{ lane: 'audio' | 'visual'; nodes: Array<Record<string, any>> }> = lanes.map(
    (lane) => ({ lane, nodes: (step[lane] || []) as Array<Record<string, any>> }),
  );
  // retry audio inside voice listen also needs valid urls
  // (spec ambiguity: retry may live on listen.voice or listen — accept both)
  const retry = (step.listen?.voice as any)?.retry ?? step.listen?.retry;
  const retryList = Array.isArray(retry) ? retry : retry ? [retry] : [];
  const retryAudio = retryList.flatMap(
    (r: any) => (r?.audio || []) as Array<Record<string, any>>,
  );
  if (retryAudio.length) groups.push({ lane: 'audio', nodes: retryAudio });

  for (const { lane, nodes } of groups) {
    for (const node of nodes) {
      const url = typeof node.url === 'string' ? node.url : undefined;
      const label = String(node.src ?? `${lane} node`);
      if (url === undefined || url.trim() === '') {
        issues.push({
          type: 'warning',
          rule: 4,
          stepId: step.id,
          message: `Node "${label}" thiếu/trống "url" → firmware sẽ bỏ qua node.`,
        });
      } else if (PLACEHOLDER_RE.test(url)) {
        issues.push({
          type: 'error',
          rule: 4,
          stepId: step.id,
          message: `Node "${label}" url còn placeholder chưa thay: ${url.slice(0, 100)}`,
        });
      } else if (lane === 'visual' && /\.(gif|webp|jpe?g)$/i.test(url)) {
        issues.push({
          type: 'warning',
          rule: 10,
          stepId: step.id,
          message: `Visual "${label}" là ${url.split('.').pop()} → chỉ hiển thị tĩnh qua .360.png.`,
        });
      }
    }
  }

  // Infinite visual (ảnh tĩnh không duration, hoặc repeat "loop") chỉ được ở node cuối.
  const visuals = (step.visual || []) as Array<Record<string, any>>;
  for (const [i, node] of visuals.slice(0, -1).entries()) {
    const url = String(node.url || '').toLowerCase();
    const isEaf = url.endsWith('.eaf');
    const hasDuration = node.duration !== undefined && node.duration !== null;
    const infinite = !hasDuration && (node.repeat === 'loop' || !isEaf);
    if (infinite) {
      issues.push({
        type: 'error',
        rule: 5,
        stepId: step.id,
        message: `Visual "${node.src}" (vị trí ${i}) vô hạn nhưng không phải node cuối → step sẽ đứng mãi.`,
      });
    }
  }
}

/** Listen rules: touch reply whitelist per layout, voice prompt contract. */
function validateListen(
  step: V3Step,
  issues: ValidationIssue[],
  prompts?: Record<string, string>,
): void {
  const listen = step.listen;
  if (!listen || listen.mode === 'none' || !listen.mode) return;

  const branches = step.branches || [];
  let valid: Set<string>;
  if (listen.mode === 'touch') {
    const layout = listen.touch?.layout || '';
    valid = new Set(TOUCH_BASE_REPLIES);
    const max = TOUCH_ZONE_MAX[layout];
    if (max) {
      for (let i = 1; i <= max; i++) valid.add(`zone${i}`);
    } else if (layout === 'swipe') {
      SWIPE_REPLIES.forEach((r) => valid.add(r));
    } else if (layout) {
      issues.push({
        type: 'error',
        rule: 6,
        stepId: step.id,
        message: `Layout touch "${layout}" không tồn tại (tb2/lr2/pie3/pie4/swipe).`,
      });
    }
  } else {
    // voice
    const voice = listen.voice;
    valid = new Set(VOICE_SYSTEM_REPLIES);
    if (Array.isArray(voice?.options)) {
      for (const opt of voice.options as any[]) {
        if (typeof opt === 'string') valid.add(opt);
        else if (opt && typeof opt === 'object' && opt.name) valid.add(String(opt.name));
      }
    }

    if (voice && voice.options !== 'any') {
      const prompt = voice.prompt;
      const ref = voice.prompt_ref;
      if (prompt && ref) {
        issues.push({
          type: 'error',
          rule: 7,
          stepId: step.id,
          message: `Dùng cả "prompt" và "prompt_ref" — chỉ được một trong hai.`,
        });
      }
      if (!prompt && !ref) {
        issues.push({
          type: 'error',
          rule: 7,
          stepId: step.id,
          message: `Voice listen thiếu "prompt" hoặc "prompt_ref".`,
        });
      } else {
        const text = prompt ?? (ref ? prompts?.[ref] : undefined);
        if (ref && prompts && !(ref in prompts)) {
          issues.push({
            type: 'error',
            rule: 7,
            stepId: step.id,
            message: `prompt_ref "${ref}" không tồn tại trong "prompts" của kịch bản.`,
          });
        }
        if (text !== undefined && !text.includes('{transcript}')) {
          issues.push({
            type: 'error',
            rule: 7,
            stepId: step.id,
            message: `Prompt thiếu placeholder "{transcript}".`,
          });
        } else if (text !== undefined && !text.includes('{options}')) {
          issues.push({
            type: 'warning',
            rule: 7,
            stepId: step.id,
            message: `Prompt không có "{options}" — LLM không thấy danh sách lựa chọn.`,
          });
        }
      }
    }
  }

  for (const b of branches) {
    const when = b.when;
    if (typeof when !== 'object' || when === null) continue;
    const reply = when.reply;
    if (typeof reply !== 'string') continue;
    if (BANNED_REPLY_TOKENS.has(reply)) {
      issues.push({
        type: 'error',
        rule: 6,
        stepId: step.id,
        message: `Reply "${reply}" là token firmware không bao giờ trả về (dùng miss/swipe_*/zone1-4).`,
      });
    } else if (!valid.has(reply)) {
      issues.push({
        type: 'error',
        rule: 6,
        stepId: step.id,
        message: `Reply "${reply}" không thuộc tập hợp lệ của layout/options.`,
      });
    }
  }
}

/**
 * Replace placeholders like `{sys.attempt}` or `{profile.child_name}` in text.
 */
export function resolvePlaceholders(text: string, memory: MemorySpaces, localVars: Record<string, any> = {}): string {
  if (!text || typeof text !== 'string') return text;

  return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (match, key: string) => {
    // 1. Check local vars (e.g. reply, match)
    if (key in localVars && localVars[key] !== undefined) {
      return String(localVars[key]);
    }

    // 2. Check 6 memory spaces
    const parts = key.split('.');
    if (parts.length >= 2) {
      const space = parts[0] as keyof MemorySpaces;
      const subKey = parts.slice(1).join('.');
      if (space in memory) {
        const val = (memory[space] as any)[subKey];
        if (val !== undefined) return String(val);
      }
    }

    return match;
  });
}
