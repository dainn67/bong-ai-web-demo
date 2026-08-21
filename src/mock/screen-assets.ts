/**
 * Stand-in artwork for the badge's screen.
 *
 * The backend is expected to send image URLs eventually, but nothing does yet
 * — so there is no way to see what the device looks like showing real content,
 * or to demo it, without inventing the content here.
 *
 * Everything is a self-contained animated SVG in `public/mock/`: no network, no
 * dependency, and it keeps working on a laptop with no wifi in front of
 * someone you are trying to impress. Swap these for real artwork by replacing
 * the files — the paths are the only contract.
 */

import type { Expression } from '../protocol/message-types';

/** A face per expression, drawn as if lit on a dark display. */
export const MOCK_FACES: Record<Expression, string> = {
  happy: '/mock/faces/happy.svg',
  sad: '/mock/faces/sad.svg',
  angry: '/mock/faces/angry.svg',
  surprised: '/mock/faces/surprised.svg',
  neutral: '/mock/faces/neutral.svg',
  thinking: '/mock/faces/thinking.svg',
  excited: '/mock/faces/excited.svg',
  sleeping: '/mock/faces/sleeping.svg',
  listening: '/mock/faces/listening.svg',
  talking: '/mock/faces/talking.svg',
  confused: '/mock/faces/confused.svg',
  waving: '/mock/faces/waving.svg',
  offline: '/mock/faces/offline.svg',
};

export interface MockScene {
  id: string;
  label: string;
  url: string;
}

/**
 * Full-screen pictures, standing in for lesson and story artwork.
 *
 * These go through exactly the path a `display` frame from the backend would,
 * so pushing one is a real test of that path and not a shortcut around it.
 */
export const MOCK_SCENES: MockScene[] = [
  { id: 'moon', label: 'Bedtime', url: '/mock/scenes/moon.svg' },
  { id: 'forest', label: 'Forest', url: '/mock/scenes/forest.svg' },
  { id: 'rocket', label: 'Rocket', url: '/mock/scenes/rocket.svg' },
  { id: 'rainbow', label: 'Colours', url: '/mock/scenes/rainbow.svg' },
];
