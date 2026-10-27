const BUCKET_NAME = "make-you-stop-deliverables";
const MAX_KEY_LENGTH = 512;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function isSafeObjectKey(key) {
  if (!key || key.length > MAX_KEY_LENGTH) return false;
  if (!key.startsWith("guides/")) return false;
  if (key.includes("\\") || key.includes("\u0000")) return false;
  if (key.includes("//") || key.includes("..")) return false;

  const parts = key.split("/");

  // Expected shape:
  // guides/{order_id}/{job_id}/{deliverable_id}.pdf
  if (parts.length !== 4) return false;
  if (parts[0] !== "guides") return false;

  const [orderId, jobId, fileName] = parts.slice(1);

  if (!/^[A-Za-z0-9_-]+$/.test(orderId)) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) return false;
  if (!/^[A-Za-z0-9_-]+\.pdf$/i.test(fileName)) return false;

  return true;
}

export default {
  async fetch(request, env) {
    if (request.method !== "PUT") {
      return json(
        {
          success: false,
          error: "Method not allowed"
        },
        405
      );
    }

    if (!env.UPLOAD_SECRET) {
      return json(
        {
          success: false,
          error: "Upload secret is not configured"
        },
        500
      );
    }

    const authorization = request.headers.get("Authorization") || "";
    const expectedAuthorization = `Bearer ${env.UPLOAD_SECRET}`;

    if (authorization !== expectedAuthorization) {
      return json(
        {
          success: false,
          error: "Unauthorized"
        },
        401
      );
    }

    const objectKey = request.headers.get("X-Object-Key") || "";

    if (!isSafeObjectKey(objectKey)) {
      return json(
        {
          success: false,
          error: "Invalid object key"
        },
        400
      );
    }

    const mimeType =
      request.headers.get("Content-Type") || "application/pdf";

    await env.BUCKET.put(objectKey, request.body, {
      httpMetadata: {
        contentType: mimeType
      }
    });

    return json({
      success: true,
      bucket: BUCKET_NAME,
      r2_key: objectKey,
      mime_type: mimeType
    });
  }
};
