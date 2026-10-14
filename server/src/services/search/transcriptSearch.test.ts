import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTranscriptMessage, transcriptHit } from './transcriptSearch.js';

const line = (o: unknown) => JSON.stringify(o);

test('extracts a user prompt given as a plain string', () => {
  assert.deepEqual(
    extractTranscriptMessage(line({ type: 'user', message: { role: 'user', content: 'fix the login bug' } })),
    { role: 'user', text: 'fix the login bug' },
  );
});

test('extracts only the text blocks of an assistant message', () => {
  const l = line({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'secret plan' },
        { type: 'text', text: 'I will edit auth.ts' },
        { type: 'tool_use', name: 'Edit', input: { file_path: 'auth.ts' } },
        { type: 'text', text: 'Done.' },
      ],
    },
  });
  assert.deepEqual(extractTranscriptMessage(l), { role: 'assistant', text: 'I will edit auth.ts\nDone.' });
});

test('non-message entries, tool-result-only turns and malformed lines yield null', () => {
  assert.equal(extractTranscriptMessage(line({ type: 'summary', summary: 'x' })), null);
  assert.equal(extractTranscriptMessage(line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } })), null);
  assert.equal(extractTranscriptMessage('{"type":"user", broken'), null);
  assert.equal(extractTranscriptMessage('null'), null);
});

test('transcriptHit drops a raw-JSON match that is not in the message text', () => {
  const l = line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Edited it' }, { type: 'tool_use', input: { file_path: 'needle.ts' } }] } });
  assert.equal(transcriptHit(l, 'needle'), null);
  const hit = transcriptHit(l, 'EDITED');
  assert.ok(hit);
  assert.equal(hit.source, 'transcript');
  assert.equal(hit.role, 'assistant');
  assert.equal(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength), 'Edited');
});
