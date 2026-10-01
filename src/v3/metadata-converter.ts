/**
 * Converter utility to translate database lesson/story metadata into valid V3Scene models.
 * Supports both node-graph schema (nodes/indexes) and story/linear schema (parts).
 */

import type { V3Scene, V3Step, V3AudioNode, V3VisualNode, OrbExpression } from './types';

interface RawNode {
  order?: string | number;
  id?: string | number;
  type?: string;
  voice?: string | null;
  audio?: any;
  audios?: any[];
  audio_url?: string | null;
  image_url?: string | null;
  gif_url?: string | null;
  visual?: any[];
  next?: string | number | null;
  branches?: any[];
  delayMs?: number;
  durationMs?: number | string;
  volume?: number;
  content?: string;
}

interface RawPart {
  id: number | string;
  type?: string;
  description?: string;
  audio_url?: string | null;
  image_url?: string | null;
  gif_url?: string | null;
  start_at?: string;
  end_at?: string;
  sleep?: number;
  expected_answer?: string;
}

/** Strip diacritics + non-alphanumerics → valid option name ^[a-z0-9_]+$. */
function slugifyBranchName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'other';
}

// Reply names reserved by the firmware/backend pipeline — never emitted as options.
const SYSTEM_REPLY_NAMES = new Set([
  'silent',
  'other',
  'unclear',
  'spoke',
  'default',
  'miss',
]);

/**
 * Build the standard classification prompt for converted question steps.
 */
function buildClassifyPrompt(questionText?: string): string {
  const ctx = questionText ? `Ngữ cảnh: ${questionText}\n` : '';
  return (
    'Bạn là bộ phân loại câu trả lời của trẻ 4-6 tuổi.\n' +
    ctx +
    'Bé nói: "{transcript}"\n' +
    'Các lựa chọn:\n{options}\n' +
    'Chỉ trả lời đúng một tên lựa chọn (chữ thuần, không JSON).'
  );
}

/**
 * Maps raw metadata type/content to an Orb expression.
 */
function inferOrbExpression(type?: string, content?: string): OrbExpression {
  const t = (type || '').toLowerCase();
  const c = (content || '').toLowerCase();

  if (t === 'câu hỏi' || t === 'question' || c.includes('hỏi') || c.includes('đoán')) {
    return 'thinking';
  }
  if (c.includes('vui') || c.includes('chúc mừng') || c.includes('giỏi')) {
    return 'happy';
  }
  if (c.includes('bất ngờ') || c.includes('ồ')) {
    return 'surprised';
  }
  if (c.includes('ngon') || c.includes('ăn')) {
    return 'delicious';
  }
  if (c.includes('buồn') || c.includes('tiếc')) {
    return 'crying';
  }
  if (c.includes('ngủ') || c.includes('mệt')) {
    return 'sleepy';
  }
  return 'happy';
}

/**
 * Converts any raw metadata object from PostgreSQL LessonCatalog into a validated V3Scene.
 */
export function convertMetadataToV3Scene(
  lessonId: string,
  _title: string,
  rawMetadata: Record<string, any>
): V3Scene {
  const steps: V3Step[] = [];

  // Case 1: Node-graph format (nodes or indexes array)
  const rawNodes: RawNode[] = Array.isArray(rawMetadata.nodes)
    ? rawMetadata.nodes
    : Array.isArray(rawMetadata.indexes)
    ? rawMetadata.indexes
    : [];

  if (rawNodes.length > 0) {
    for (let i = 0; i < rawNodes.length; i++) {
      const node = rawNodes[i];
      const stepId = String(node.order ?? node.id ?? i + 1);

      // Collect audio — emit both src (simulator fetches it) and url (firmware contract)
      const audioNodes: V3AudioNode[] = [];
      if (Array.isArray(node.audio)) {
        for (const a of node.audio) {
          if (a?.url) {
            audioNodes.push({
              src: a.url,
              url: a.url,
              wait: a.waitMs,
              volume: a.volume,
            });
          }
        }
      } else if (typeof node.audio === 'string' && node.audio) {
        audioNodes.push({ src: node.audio, url: node.audio });
      } else if (node.audio_url) {
        audioNodes.push({ src: node.audio_url, url: node.audio_url });
      }

      // Collect visuals
      const visualNodes: V3VisualNode[] = [];
      if (Array.isArray(node.visual)) {
        for (const v of node.visual) {
          if (v?.url) {
            visualNodes.push({
              src: v.url,
              url: v.url,
              hold: v.stop !== 'tat',
            });
          }
        }
      } else if (node.image_url || node.gif_url) {
        const url = node.image_url || node.gif_url;
        if (url) visualNodes.push({ src: url, url, hold: true });
      }

      // Interaction mode
      const isQuestion =
        node.type === 'câu hỏi' ||
        node.type === 'question' ||
        (Array.isArray(node.branches) && node.branches.length > 0);

      // Determine next step
      const nextStepId = node.next !== undefined && node.next !== null
        ? String(node.next)
        : i + 1 < rawNodes.length
        ? String(rawNodes[i + 1].order ?? rawNodes[i + 1].id ?? i + 2)
        : undefined;

      const step: V3Step = {
        id: stepId,
        orb: inferOrbExpression(node.type, node.content),
        audio: audioNodes.length > 0 ? audioNodes : undefined,
        visual: visualNodes.length > 0 ? visualNodes : undefined,
      };

      if (isQuestion && Array.isArray(node.branches) && node.branches.length > 0) {
        // Emit real option list from branch types so replies can actually match.
        // branchType strings become option names (system replies excluded).
        const optionNames: string[] = [];
        const branches = node.branches.map((b: any) => {
          const rawName = String(b.branchType || b.name || b.expected_answer || '').trim();
          const name = slugifyBranchName(rawName);
          if (rawName && !SYSTEM_REPLY_NAMES.has(rawName.toLowerCase()) && !optionNames.includes(name)) {
            optionNames.push(name);
          }
          const whenName = name || 'other';
          return {
            when:
              typeof b.when === 'string' && (b.when === 'default' || b.when.includes('{'))
                ? b.when
                : `{reply} = ${whenName}`,
            go: b.next ? String(b.next) : nextStepId,
          };
        });
        step.listen = {
          mode: 'voice',
          voice:
            optionNames.length > 0
              ? {
                  options: optionNames.map((n) => ({ name: n, desc: n })),
                  prompt: buildClassifyPrompt(node.content),
                }
              : {
                  options: [
                    { name: 'yes', desc: 'bé đồng ý / nói đúng' },
                    { name: 'no', desc: 'bé từ chối / nói sai' },
                  ],
                  prompt: buildClassifyPrompt(node.content),
                },
        };
        // Format branches, ensure last branch is default

        const hasDefault = branches.some((b: any) => b.when === 'default' || !b.when);
        if (!hasDefault) {
          branches.push({
            when: 'default',
            go: nextStepId,
          });
        }
        step.branches = branches;
      } else {
        step.next = nextStepId;
      }

      steps.push(step);
    }
  }

  // Case 2: Linear parts format (Stories / traditional lessons)
  const rawParts: RawPart[] = Array.isArray(rawMetadata.parts) ? rawMetadata.parts : [];
  if (steps.length === 0 && rawParts.length > 0) {
    for (let i = 0; i < rawParts.length; i++) {
      const part = rawParts[i];
      const stepId = String(part.id);
      const nextPartId = i + 1 < rawParts.length ? String(rawParts[i + 1].id) : undefined;

      const isQuestion = part.type === 'question' || Boolean(part.expected_answer);

      const step: V3Step = {
        id: stepId,
        orb: inferOrbExpression(part.type, part.description),
        audio: part.audio_url
          ? [{ src: part.audio_url, url: part.audio_url }]
          : undefined,
        visual: part.image_url
          ? [{ src: part.image_url, url: part.image_url, hold: true }]
          : undefined,
      };

      if (isQuestion) {
        const expected = part.expected_answer?.trim();
        if (expected) {
          step.listen = {
            mode: 'voice',
            voice: {
              // `other` is a mode-reserved branch — the machine generates it;
              // content only declares the positive match.
              options: [
                { name: 'match', desc: `bé nói "${expected}" hoặc tương đương` },
              ],
              prompt: buildClassifyPrompt(part.description),
            },
          };
          step.branches = [
            { when: '{reply} = match', go: nextPartId },
            { when: 'default', go: nextPartId },
          ];
        } else {
          // no expected answer → `hear` mode (local, no server)
          step.listen = { mode: 'hear' };
          step.branches = [
            { when: '{reply} = spoke', go: nextPartId },
            { when: 'default', go: nextPartId },
          ];
        }
      } else {
        step.next = nextPartId;
      }

      steps.push(step);
    }
  }

  // Fallback if metadata had no nodes or parts
  if (steps.length === 0) {
    steps.push({
      id: 'step_1',
      orb: 'happy',
      audio: rawMetadata.audio_url
        ? [{ src: rawMetadata.audio_url, url: rawMetadata.audio_url }]
        : undefined,
      visual: rawMetadata.image_url
        ? [{ src: rawMetadata.image_url, url: rawMetadata.image_url }]
        : undefined,
    });
  }

  const entry = steps[0].id;

  return {
    id: lessonId,
    entry,
    screen: {
      base: 'orb',
      orb: steps[0].orb || 'happy',
    },
    volume: 80,
    steps,
  };
}
