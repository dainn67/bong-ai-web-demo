import { describe, it, expect } from 'vitest';
import { getCapabilityMatrix } from './capability-matrix';

describe('capability-matrix', () => {
  it('categorizes capabilities into Firmware Truth, Simulator Parity, and Dev Harness Only', () => {
    const matrix = getCapabilityMatrix({
      hasManifest: true,
      hasUnwrappedKey: true,
      sdSceneCount: 4,
      pendingJourneyLines: 0,
    });

    expect(matrix.firmwareTruth.length).toBeGreaterThanOrEqual(4);
    expect(matrix.simulatorParity.length).toBeGreaterThanOrEqual(4);
    expect(matrix.devHarnessOnly.length).toBeGreaterThanOrEqual(3);

    const aesKwItem = matrix.simulatorParity.find((i) => i.id === 'aes_kw_bong');
    expect(aesKwItem?.status).toBe('ready');

    const previewItem = matrix.devHarnessOnly.find((i) => i.id === 'preview_journey');
    expect(previewItem).toBeDefined();
  });
});
