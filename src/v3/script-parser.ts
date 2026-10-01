/**
 * Script Parser and Validator for v3 Scene JSON (B16 ruleset — V1–V10 / W1–W5).
 * Mirrors backend-python/app/services/scene_validation_service.py; keep rule
 * ids in lockstep so demo-side validation matches release intake.
 */

import type { V3Scene, V3Step, MemorySpaces } from './types';
import { tokenizeWhen } from './when-expr';

export interface ValidationIssue {
  type: 'error' | 'warning';
  stepId?: string;
  rule: string;
  message: string;
}

const SCENE_ID_RE = /^[A-Z][A-Za-z0-9_.\-]*$/;
const STEP_ID_RE = /^[a-z0-9_]+$/;
const OPTION_NAME_RE = /^[a-z0-9_]+$/;
const PLACEHOLDER_RE = /\{[^{}]*\}/;
const PROMPT_REF_RE = /\{prompts\.([A-Za-z0-9_]+)\}/g;
const LISTS_REF_RE = /\{lists\.([A-Za-z0-9_]+)\.(value|say)\}/g;

const MODE_DEFAULT_BRANCHES: Record<string, Set<string>> = {
  hear: new Set(['spoke', 'silent']),
  voice: new Set(['silent', 'other', 'unclear', 'error']),
  touch: new Set(['silent', 'miss']),
  pet: new Set(['silent', 'miss']),
  talk: new Set(['silent', 'limit', 'safety', 'error', 'other']),
};
const TOUCH_ZONE_MAX: Record<string, number> = { tb2: 2, lr2: 2, pie3: 3, pie4: 4 };
const VALID_LISTEN_MODES = new Set(['hear', 'voice', 'touch', 'pet']);
const BONG_VOICES = new Set(['bong', 'bống']);
const BANNED_PLACEHOLDERS = ['value', 'match', 'attempt', 'sys.match', 'sys.attempt', 'nbest'];

export interface ValidateOptions {
  prompts?: Record<string, string>; // manifest prompt store
  lists?: Record<string, Array<{ value: string; say?: string[] }>>;
}

export function validateV3Scene(
  scene: unknown,
  opts: ValidateOptions = {},
): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  if (!scene || typeof scene !== 'object') {
    return {
      valid: false,
      issues: [{ type: 'error', rule: 'V1', message: 'Kịch bản phải là một JSON object hợp lệ.' }],
    };
  }

  const s = scene as Partial<V3Scene>;

  // V1: scene header
  if (!s.id) issues.push({ type: 'error', rule: 'V1', message: 'Thiếu trường "id" của kịch bản.' });
  else if (!SCENE_ID_RE.test(s.id) || s.id.includes('#') || s.id.includes(' '))
    issues.push({
      type: 'error',
      rule: 'V1',
      message: `Scene id "${s.id}" phải bắt đầu A-Z, không chứa "#"/dấu cách.`,
    });
  if (!s.entry) issues.push({ type: 'error', rule: 'V1', message: 'Thiếu "entry" (step bắt đầu).' });
  if (!Array.isArray(s.steps) || s.steps.length === 0) {
    issues.push({ type: 'error', rule: 'V1', message: 'Danh sách "steps" rỗng hoặc không phải mảng.' });
    return { valid: false, issues };
  }

  const stepIds = new Set<string>();
  for (const step of s.steps) {
    if (!step.id) {
      issues.push({ type: 'error', rule: 'V1', message: 'Có step thiếu trường "id".' });
      continue;
    }
    if (stepIds.has(step.id))
      issues.push({ type: 'error', rule: 'V1', stepId: step.id, message: `Trùng lặp step id: "${step.id}".` });
    if (!STEP_ID_RE.test(step.id))
      issues.push({
        type: 'error',
        rule: 'V1',
        stepId: step.id,
        message: `Step id "${step.id}" chỉ được chứa [a-z0-9_].`,
      });
    stepIds.add(step.id);
  }
  if (s.entry && !stepIds.has(s.entry))
    issues.push({ type: 'error', rule: 'V1', message: `"entry" trỏ tới step "${s.entry}" không tồn tại.` });

  if ('prompts' in (s as object))
    issues.push({
      type: 'warning',
      rule: 'V6',
      message: 'Khối "prompts" cấp kịch bản không còn dùng — prompt giờ ở manifest store.',
    });

  for (const step of s.steps) {
    if (step && step.id) validateStep(step, issues, stepIds, opts);
  }

  return { valid: !issues.some((i) => i.type === 'error'), issues };
}

function validateStep(
  step: V3Step,
  issues: ValidationIssue[],
  allStepIds: Set<string>,
  opts: ValidateOptions,
): void {
  const sid = step.id;

  if (step.branches && step.next)
    issues.push({ type: 'error', rule: 'V8', stepId: sid, message: `"${sid}" có cả "next" và "branches".` });

  const listen = step.listen || ({} as NonNullable<V3Step['listen']>);
  const mode = listen.mode;
  const talk = step.talk;
  const hasTalk = !!talk && typeof talk === 'object' && Object.keys(talk).length > 0;

  if (mode && !step.branches)
    issues.push({ type: 'error', rule: 'V8', stepId: sid, message: `"${sid}" có listen "${mode}" nhưng thiếu "branches".` });
  if (hasTalk && !step.branches)
    issues.push({ type: 'error', rule: 'V8', stepId: sid, message: `"${sid}" có "talk" nhưng thiếu "branches".` });

  const declared = checkBranches(step, issues, allStepIds);

  checkVisuals(step, issues);

  if (mode) checkListen(step, listen, mode, declared, issues, opts);
  else if (listen && Object.keys(listen).length > 0 && !('mode' in listen))
    issues.push({ type: 'error', rule: 'V2', stepId: sid, message: `"${sid}": listen thiếu "mode".` });

  if (hasTalk && talk) checkTalk(step, talk, declared, issues, opts);

  // V10: save write-guard
  checkSave(step.save, 'step', sid, issues);
  for (const node of [...(step.audio || []), ...(step.visual || [])])
    if (node && typeof node === 'object') checkSave((node as any).save, 'node', sid, issues);
  for (const b of step.branches || [])
    if (b && typeof b === 'object') checkSave(b.save, 'branch', sid, issues);

  // V9: banned placeholders anywhere + placeholders in forbidden fields
  const stepText = JSON.stringify(step);
  for (const banned of BANNED_PLACEHOLDERS) {
    if (stepText.includes(`{${banned}}`))
      issues.push({
        type: 'error',
        rule: 'V9',
        stepId: sid,
        message: `"${sid}": placeholder {${banned}} đã bị xoá khỏi hợp đồng.`,
      });
  }
  const forbiddenFields: Array<[string, unknown]> = [
    ['id', step.id],
    ['orb', step.orb],
    ['listen.mode', listen.mode],
    ['listen.timeout', listen.timeout],
    ['talk.turns', talk?.turns],
    ['talk.sec', talk?.sec],
    ['talk.voice', talk?.voice],
  ];
  for (const [label, val] of forbiddenFields) {
    if (typeof val === 'string' && PLACEHOLDER_RE.test(val))
      issues.push({ type: 'error', rule: 'V9', stepId: sid, message: `"${sid}": trường "${label}" không được chứa placeholder.` });
  }

  // V4: {lists.x.*} only legal inside option name/desc
  checkListsOutsideOptions(step, sid, issues);

  // W5: reads {reply} without listen/talk
  if (!mode && !hasTalk && stepReadsReply(step))
    issues.push({
      type: 'warning',
      rule: 'W5',
      stepId: sid,
      message: `"${sid}" không có listen/talk mà đọc "{reply}" — giá trị của một cửa sổ nghe đã qua.`,
    });
}

// ---------------------------------------------------------------- V8 branches
function checkBranches(
  step: V3Step,
  issues: ValidationIssue[],
  allStepIds: Set<string>,
): Set<string> {
  const declared = new Set<string>();
  const branches = step.branches || [];
  const sid = step.id;

  if (typeof step.next === 'string') checkTarget(step.next, allStepIds, sid, issues);
  if (branches.length === 0) return declared;

  for (const [i, b] of branches.entries()) {
    if (!b || typeof b !== 'object') {
      issues.push({ type: 'error', rule: 'V8', stepId: sid, message: `"${sid}": nhánh [${i}] không phải object.` });
      continue;
    }
    const when = b.when;
    if (when === 'default') {
      if (i !== branches.length - 1)
        issues.push({ type: 'error', rule: 'V8', stepId: sid, message: `"${sid}": "default" chỉ được ở nhánh cuối.` });
    } else if (typeof when === 'string') {
      const errs = validateWhenExpr(when);
      for (const err of errs)
        issues.push({ type: 'error', rule: 'V9', stepId: sid, message: `"${sid}": when "${when.slice(0, 60)}" — ${err}.` });
      for (const lit of replyLiteralsOf(when)) declared.add(lit);
    } else {
      issues.push({
        type: 'error',
        rule: 'V9',
        stepId: sid,
        message: `"${sid}": "when" phải là chuỗi Excel-style hoặc "default", nhận ${typeof when}.`,
      });
    }
    const target = b.go ?? b.next;
    if (typeof target === 'string') checkTarget(target, allStepIds, sid, issues);
    if (b.go === sid)
      issues.push({
        type: 'warning',
        rule: 'W1',
        stepId: sid,
        message: `"${sid}" tự quay về chính nó qua "go" — dùng "retry" một lần thay thế.`,
      });
  }

  const last = branches[branches.length - 1];
  if (last && last.when !== 'default')
    issues.push({ type: 'error', rule: 'V8', stepId: sid, message: `"${sid}": nhánh cuối branches phải là "default".` });

  return declared;
}

function checkTarget(target: string, allStepIds: Set<string>, sid: string, issues: ValidationIssue[]): void {
  if (PLACEHOLDER_RE.test(target)) return;
  if (allStepIds.has(target)) return;
  if (/^[A-Za-z0-9_.\-]+#[A-Za-z0-9_]+$/.test(target)) return; // SCENE#step
  if (SCENE_ID_RE.test(target)) return; // bare SCENE
  issues.push({ type: 'error', rule: 'V8', stepId: sid, message: `"${sid}": đích "${target}" không tồn tại.` });
}

/** Static check of a `when` expression via the tokenizer (parse-only). */
function validateWhenExpr(expr: string): string[] {
  const trimmed = expr.trim();
  if (!trimmed) return ['empty `when` expression'];
  const toks = tokenizeWhen(trimmed);
  if (typeof toks === 'string') return [toks];
  const errs: string[] = [];
  // variable whitelist + parens balance
  let depth = 0;
  for (const t of toks) {
    if (t.k === 'var') {
      const name = t.v;
      if (name === 'reply') continue;
      if (name.startsWith('cfg.')) errs.push('{cfg.*} is not readable inside `when`');
      else if (name.includes('*')) errs.push(`group placeholder {${name}} not allowed in \`when\``);
      else if (!/^(sys|profile|learn|user|stat|tmp)\.[A-Za-z0-9_]+$/.test(name))
        errs.push(`non-variable placeholder {${name}} in \`when\``);
    }
    if (t.k === 'lit' && (t.v === 'true' || t.v === 'false'))
      errs.push(`literal '${t.v}' must be uppercase TRUE/FALSE`);
    if (t.k === 'func' && !['AND', 'OR', 'NOT', 'ISBLANK'].includes(t.v))
      errs.push(`unknown function '${t.v}'`);
    if (t.k === 'lp') depth++;
    if (t.k === 'rp') depth--;
    if (depth < 0) { errs.push("unbalanced ')' in `when`"); break; }
  }
  if (depth > 0) errs.push("unclosed '(' in `when`");
  return errs;
}

/** Literal values compared to {reply} anywhere in the expr — used for W1/W3. */
function replyLiteralsOf(expr: string): string[] {
  const out: string[] = [];
  const re = /\{reply\}\s*=\s*([^\s,(){}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------- V2 listen modes
function checkListen(
  step: V3Step,
  listen: NonNullable<V3Step['listen']>,
  mode: string,
  declared: Set<string>,
  issues: ValidationIssue[],
  opts: ValidateOptions,
): void {
  const sid = step.id;
  if (!VALID_LISTEN_MODES.has(mode)) {
    issues.push({ type: 'error', rule: 'V2', stepId: sid, message: `"${sid}": listen.mode "${mode}" không hợp lệ.` });
    return;
  }
  const defaults = MODE_DEFAULT_BRANCHES[mode];
  const possible = new Set(defaults);

  if (mode === 'hear') {
    if ((listen as any).prompt !== undefined || (listen as any).options !== undefined || (listen as any).voice)
      issues.push({ type: 'error', rule: 'V2', stepId: sid, message: `"${sid}": mode "hear" không được có prompt/options.` });
  } else if (mode === 'voice') {
    const voice: any = listen.voice || {};
    const voicePrompt = (listen as any).prompt ?? voice.prompt;
    const voiceOptions = (listen as any).options ?? voice.options;
    if (!Array.isArray(voiceOptions) || voiceOptions.length === 0)
      issues.push({ type: 'error', rule: 'V2', stepId: sid, message: `"${sid}": mode "voice" thiếu "options" hoặc options rỗng.` });
    if (!voicePrompt)
      issues.push({ type: 'error', rule: 'V2', stepId: sid, message: `"${sid}": mode "voice" thiếu "prompt".` });
    else checkPrompt(voicePrompt, 'voice', sid, issues, opts);
    if (Array.isArray(voiceOptions)) {
      checkOptions(voiceOptions, defaults, 'V3', sid, issues, opts, false);
      for (const opt of voiceOptions)
        if (opt && typeof opt.name === 'string' && OPTION_NAME_RE.test(opt.name)) possible.add(opt.name);
      for (const opt of voiceOptions) {
        const name = opt?.name;
        if (typeof name === 'string' && OPTION_NAME_RE.test(name) && !declared.has(name))
          issues.push({
            type: 'warning',
            rule: 'W3',
            stepId: sid,
            message: `"${sid}": option "${name}" không xuất hiện trong điều kiện nào của branches.`,
          });
      }
    }
  } else if (mode === 'touch') {
    const layout = (listen as any).layout ?? listen.touch?.layout;
    if (!layout || !(layout in TOUCH_ZONE_MAX) && layout !== 'swipe')
      issues.push({ type: 'error', rule: 'V2', stepId: sid, message: `"${sid}": mode "touch" thiếu/sai "layout".` });
    else {
      if (layout in TOUCH_ZONE_MAX)
        for (let i = 1; i <= TOUCH_ZONE_MAX[layout]; i++) possible.add(`zone${i}`);
      else ['swipe_up', 'swipe_down', 'swipe_left', 'swipe_right'].forEach((r) => possible.add(r));
    }
    const hasHold = (step.visual || []).some((v: any) => v && v.hold === true);
    if (!hasHold)
      issues.push({ type: 'error', rule: 'V2', stepId: sid, message: `"${sid}": mode "touch" cần một visual đang hiện (hold: true).` });
  } else if (mode === 'pet') {
    if ((listen as any).gestures !== undefined || (listen as any).pet?.gestures !== undefined)
      issues.push({ type: 'error', rule: 'V2', stepId: sid, message: `"${sid}": mode "pet" không còn trường "gestures".` });
    ['stroke_slow', 'stroke_fast', 'spin', 'tap', 'cover', 'uncover'].forEach((r) => possible.add(r));
  }

  // W1: missing mode default branches
  const missing = [...defaults].filter((d) => !declared.has(d));
  if (missing.length)
    issues.push({
      type: 'warning',
      rule: 'W1',
      stepId: sid,
      message: `"${sid}": mode "${mode}" chưa khai nhánh mặc định [${missing.join(', ')}] — "default" sẽ bắt chúng.`,
    });

  // V5: retry single-object
  const retry = listen.retry;
  if (retry !== undefined && retry !== null) checkRetry(retry, possible, sid, issues);
}

function checkRetry(retry: unknown, possible: Set<string>, sid: string, issues: ValidationIssue[]): void {
  if (!retry || typeof retry !== 'object' || Array.isArray(retry)) {
    issues.push({ type: 'error', rule: 'V5', stepId: sid, message: `"${sid}": "retry" phải là object {on, audio}.` });
    return;
  }
  const r = retry as { on?: string[]; audio?: unknown[] };
  if (!Array.isArray(r.on) || r.on.length === 0)
    issues.push({ type: 'error', rule: 'V5', stepId: sid, message: `"${sid}": retry thiếu "on".` });
  else
    for (const v of r.on) {
      if (v === 'error')
        issues.push({ type: 'warning', rule: 'W2', stepId: sid, message: `"${sid}": retry.on chứa "error" — hỏi lại lỗi kỹ thuật vô nghĩa.` });
      else if (!possible.has(v))
        issues.push({ type: 'error', rule: 'V5', stepId: sid, message: `"${sid}": retry.on chứa "${v}" — không thể xảy ra với mode này.` });
    }
  if (!Array.isArray(r.audio) || r.audio.length === 0)
    issues.push({ type: 'error', rule: 'V5', stepId: sid, message: `"${sid}": retry thiếu "audio".` });
}

// ---------------------------------------------------------------- V3/V4 options
function checkOptions(
  options: unknown[],
  reserved: Set<string>,
  rule: string,
  sid: string,
  issues: ValidationIssue[],
  opts: ValidateOptions,
  isTalk: boolean,
): void {
  for (const [i, opt] of options.entries()) {
    if (!opt || typeof opt !== 'object') {
      issues.push({ type: 'error', rule, stepId: sid, message: `"${sid}": option[${i}] phải là object {name, desc}.` });
      continue;
    }
    const o = opt as { name?: unknown; desc?: unknown };
    if (typeof o.name !== 'string' || !o.name) {
      issues.push({ type: 'error', rule, stepId: sid, message: `"${sid}": option[${i}] thiếu "name".` });
      continue;
    }
    if (o.desc === undefined || typeof o.desc !== 'string')
      issues.push({ type: 'error', rule, stepId: sid, message: `"${sid}": option "${o.name}" thiếu "desc".` });

    const listRef = /^\{lists\.([A-Za-z0-9_]+)\.value\}$/.exec(o.name);
    if (listRef) {
      checkListsRef(listRef[1], sid, issues, opts);
    } else if (!OPTION_NAME_RE.test(o.name)) {
      issues.push({
        type: 'error',
        rule,
        stepId: sid,
        message: `"${sid}": option name "${o.name}" sai định dạng [a-z0-9_]+ (chỉ {lists.x.value} được phép).`,
      });
    } else if (isTalk && o.name === 'continue') {
      issues.push({ type: 'error', rule: 'V7', stepId: sid, message: `"${sid}": option tên "continue" là từ dành riêng của talk.` });
    } else if (reserved.has(o.name)) {
      issues.push({ type: 'error', rule: 'V4', stepId: sid, message: `"${sid}": option "${o.name}" trùng tên nhánh mặc định của mode.` });
    }
    if (typeof o.desc === 'string')
      for (const m of o.desc.matchAll(LISTS_REF_RE)) checkListsRef(m[1], sid, issues, opts);
  }
}

function checkListsOutsideOptions(step: V3Step, sid: string, issues: ValidationIssue[]): void {
  const scan = (obj: unknown, path: string): void => {
    if (typeof obj === 'string') {
      for (const m of obj.matchAll(LISTS_REF_RE)) {
        issues.push({
          type: 'error',
          rule: 'V4',
          stepId: sid,
          message: `"${sid}": {lists.${m[1]}.${m[2]}} ngoài vùng option (tại ${path}) — lists chỉ mở rộng option name/desc.`,
        });
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((v, i) => scan(v, `${path}[${i}]`));
    } else if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) scan(v, `${path}.${k}`);
    }
  };
  for (const [key, value] of Object.entries(step)) {
    if (key === 'listen' || key === 'talk') continue; // options checked by own rules
    scan(value, key);
  }
}

function checkListsRef(listName: string, sid: string, issues: ValidationIssue[], opts: ValidateOptions): void {
  if (!opts.lists) return;
  const entries = opts.lists[listName];
  if (!entries) {
    issues.push({ type: 'error', rule: 'V4', stepId: sid, message: `"${sid}": {lists.${listName}} không có trong kho lists.` });
    return;
  }
  for (const [j, e] of entries.entries()) {
    if (typeof e?.value !== 'string' || !OPTION_NAME_RE.test(e.value))
      issues.push({ type: 'error', rule: 'V4', stepId: sid, message: `"${sid}": lists.${listName}[${j}].value sai định dạng.` });
  }
}

// ---------------------------------------------------------------- V6 prompts
function checkPrompt(
  prompt: string,
  kind: 'voice' | 'talk',
  sid: string,
  issues: ValidationIssue[],
  opts: ValidateOptions,
): void {
  const resolved = resolvePromptRefs(prompt, opts.prompts, sid, issues);
  if (resolved.includes('{nbest}'))
    issues.push({ type: 'error', rule: 'V6', stepId: sid, message: `"${sid}": prompt chứa {nbest} — placeholder đã bỏ.` });
  if (kind === 'voice' && !resolved.includes('{transcript}'))
    issues.push({ type: 'error', rule: 'V6', stepId: sid, message: `"${sid}": prompt voice thiếu "{transcript}".` });
  if (!resolved.includes('{options}'))
    issues.push({
      type: 'error',
      rule: 'V6',
      stepId: sid,
      message: `"${sid}": prompt ${kind} thiếu "{options}" — LLM không thấy danh sách lựa chọn.`,
    });
}

function resolvePromptRefs(
  prompt: string,
  prompts: Record<string, string> | undefined,
  sid: string,
  issues: ValidationIssue[],
): string {
  let resolved = prompt;
  for (const m of prompt.matchAll(PROMPT_REF_RE)) {
    const name = m[1];
    if (!prompts) continue;
    const content = prompts[name];
    if (content === undefined)
      issues.push({ type: 'error', rule: 'V6', stepId: sid, message: `"${sid}": {prompts.${name}} không có trong kho prompt.` });
    else resolved = resolved.replace(`{prompts.${name}}`, content);
  }
  return resolved;
}

// ---------------------------------------------------------------- V7 talk
function checkTalk(
  step: V3Step,
  talk: NonNullable<V3Step['talk']>,
  declared: Set<string>,
  issues: ValidationIssue[],
  opts: ValidateOptions,
): void {
  const sid = step.id;
  for (const req of ['voice', 'prompt', 'turns', 'sec', 'options'] as const)
    if (talk[req] === undefined || talk[req] === null)
      issues.push({ type: 'error', rule: 'V7', stepId: sid, message: `"${sid}": talk thiếu "${req}".` });
  if (typeof talk.voice === 'string' && BONG_VOICES.has(talk.voice.trim().toLowerCase()))
    issues.push({ type: 'error', rule: 'V7', stepId: sid, message: `"${sid}": talk.voice không được là giọng Bống.` });
  if (Array.isArray(talk.options))
    checkOptions(talk.options, new Set([...MODE_DEFAULT_BRANCHES.talk, 'continue']), 'V3', sid, issues, opts, true);
  if (typeof talk.prompt === 'string') {
    const resolved = resolvePromptRefs(talk.prompt, opts.prompts, sid, issues);
    if (resolved.includes('{nbest}'))
      issues.push({ type: 'error', rule: 'V6', stepId: sid, message: `"${sid}": prompt talk chứa {nbest}.` });
    if (!resolved.includes('{options}'))
      issues.push({ type: 'error', rule: 'V6', stepId: sid, message: `"${sid}": prompt talk thiếu "{options}".` });
    if (!resolved.includes('{history}'))
      issues.push({
        type: 'warning',
        rule: 'W4',
        stepId: sid,
        message: `"${sid}": prompt talk không có "{history}" — hội thoại sẽ không nhớ lượt trước.`,
      });
  }
  const missing = [...MODE_DEFAULT_BRANCHES.talk].filter((d) => !declared.has(d));
  if (missing.length)
    issues.push({
      type: 'warning',
      rule: 'W1',
      stepId: sid,
      message: `"${sid}": talk chưa khai nhánh mặc định [${missing.join(', ')}] — "default" sẽ bắt chúng.`,
    });
  if ((talk as any).retry !== undefined || step.listen?.retry !== undefined)
    issues.push({ type: 'warning', rule: 'W2', stepId: sid, message: `"${sid}": "talk" không có "retry" — trường này bị bỏ qua.` });
}

// ---------------------------------------------------------------- V10 + visuals
function checkSave(save: unknown, owner: string, sid: string, issues: ValidationIssue[]): void {
  if (!save || typeof save !== 'object') return;
  for (const key of Object.keys(save as object))
    if (key.startsWith('sys.') || key.startsWith('profile.'))
      issues.push({
        type: 'error',
        rule: 'V10',
        stepId: sid,
        message: `"${sid}": save (${owner}) ghi vào "${key}" — sys.*/profile.* là read-only.`,
      });
}

function checkVisuals(step: V3Step, issues: ValidationIssue[]): void {
  const sid = step.id;
  const visuals = step.visual || [];
  for (const node of visuals.slice(0, -1)) {
    if (!node || typeof node !== 'object') continue;
    const src = String(node.src ?? node.url ?? '').toLowerCase();
    const isEaf = src.endsWith('.eaf');
    const hasDuration = node.duration !== undefined && node.duration !== null;
    const infinite = !hasDuration && (node.repeat === 'loop' || !isEaf);
    if (infinite)
      issues.push({
        type: 'error',
        rule: 'V10',
        stepId: sid,
        message: `"${sid}": visual "${node.src ?? node.url}" vô hạn nhưng không phải node cuối → step sẽ đứng mãi.`,
      });
  }
  for (const node of visuals) {
    if (!node || typeof node !== 'object') continue;
    const url = String(node.url ?? '');
    if (/\.(gif|webp|jpe?g)$/i.test(url))
      issues.push({
        type: 'warning',
        rule: 'W5',
        stepId: sid,
        message: `"${sid}": visual "${node.src}" là ${url.split('.').pop()} → chỉ hiển thị tĩnh qua .360.png.`,
      });
  }
}

function stepReadsReply(step: V3Step): boolean {
  for (const k of ['src', 'go', 'next'] as const) {
    const v = (step as any)[k];
    if (typeof v === 'string' && v.includes('{reply}')) return true;
  }
  if (step.save && typeof step.save === 'object')
    for (const [k, v] of Object.entries(step.save))
      if (k.includes('{reply}') || String(v).includes('{reply}')) return true;
  for (const node of [...(step.audio || []), ...(step.visual || [])])
    if (node && typeof node === 'object' && typeof node.src === 'string' && node.src.includes('{reply}')) return true;
  return false;
}

/**
 * Replace placeholders like `{profile.child_name}` in text; `{x.*}` group form
 * expands to "key: value" lines. Unresolved keys become the literal `null`.
 */
export function resolvePlaceholders(
  text: string,
  memory: MemorySpaces,
  localVars: Record<string, any> = {},
): string {
  if (!text || typeof text !== 'string') return text;

  return text.replace(/\{([a-zA-Z0-9_.*]+)\}/g, (match, key: string) => {
    if (key in localVars && localVars[key] !== undefined) return String(localVars[key]);

    // group expansion {sys.*} → "k1: v1\nk2: v2"
    if (key.endsWith('.*')) {
      const space = key.slice(0, -2) as keyof MemorySpaces;
      const scope = memory[space] as Record<string, unknown> | undefined;
      if (!scope || Object.keys(scope).length === 0) return 'null';
      return Object.entries(scope)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    }

    const parts = key.split('.');
    if (parts.length >= 2) {
      const space = parts[0] as keyof MemorySpaces;
      const subKey = parts.slice(1).join('.');
      if (space in memory) {
        const val = (memory[space] as any)[subKey];
        if (val !== undefined) return String(val);
      }
      return 'null'; // blank key → literal "null" in text (§3.12)
    }

    return match; // non-variable placeholder ({options}, {transcript}…) — leave
  });
}
