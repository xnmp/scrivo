import { extractHeadings } from './headings';

self.onmessage = (event: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = event.data;
  try { self.postMessage({ id, headings: extractHeadings(text) }); }
  catch (error) { self.postMessage({ id, error: String(error) }); }
};
