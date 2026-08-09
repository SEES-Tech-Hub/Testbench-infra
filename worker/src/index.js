// Cloudflare Worker — the trigger between the Floater's API and the Pipeline service.
// Triggered by the Floater's POST /uploads/:id/start.
// Calls the Pipeline service's POST /internal/process and returns immediately,
// so neither backend service blocks on the other.

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { upload_id, storage_key, question_format } = body;
    if (!upload_id || !storage_key || !question_format) {
      return new Response(
        JSON.stringify({ error: 'upload_id, storage_key, and question_format are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // fire-and-forget to the Pipeline service — do not await full completion,
    // only its immediate 202 acknowledgment
    await fetch(env.PIPELINE_SERVICE_URL + '/internal/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_id, storage_key, question_format })
    });

    return new Response(JSON.stringify({ status: 'processing' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
