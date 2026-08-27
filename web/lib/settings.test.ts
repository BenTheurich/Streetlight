import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultChurchPrintoutSettings, parseChurchPrintoutSettings } from './settings.ts';

test('printout settings preserve the church default and normalize saved copy', () => {
  assert.deepEqual(
    parseChurchPrintoutSettings({
      message: `  ${defaultChurchPrintoutSettings.message}  `,
      reference: defaultChurchPrintoutSettings.reference,
    }),
    defaultChurchPrintoutSettings,
  );
});

test('printout settings allow removal but reject an orphaned reference', () => {
  assert.deepEqual(parseChurchPrintoutSettings({ message: '', reference: '' }), {
    message: '',
    reference: '',
  });
  assert.throws(
    () => parseChurchPrintoutSettings({ message: '', reference: 'Matthew 5:14' }),
    /reference requires a printout message/,
  );
});
test('printout settings reject characters the PDF footer font cannot render', () => {
  assert.throws(
    () => parseChurchPrintoutSettings({ message: 'Light in the world 🌎', reference: '' }),
    /Message can use standard letters, numbers, and punctuation only/,
  );
});
