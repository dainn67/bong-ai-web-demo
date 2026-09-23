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
    validateStep(step, issues, stepIds);
  }

  const hasErrors = issues.some((i) => i.type === 'error');
  return { valid: !hasErrors, issues };
}

function validateStep(step: V3Step, issues: ValidationIssue[], allStepIds: Set<string>): void {
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
