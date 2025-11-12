// Import Vercel's Edge-compatible request object
import { type NextRequest } from 'next/server';

// Tell Vercel to run this as an Edge Function
export const config = {
    runtime: 'edge',
};

/*
    WARNING: This in-memory rate limiter is for demonstration only.
    It WILL NOT work reliably on Vercel Edge Functions for high traffic
    due to requests being handled by different, stateless instances.
    For a production-ready solution, use Vercel KV (@vercel/kv).
*/
const RATE_LIMIT = 60; // Max requests per minute per IP
const ipMap = new Map<string, number[]>(); // Using a Map for in-memory store

// The 'handle' function from Deno becomes the default export
export default async function handle(request: NextRequest): Promise<Response> {

    // --- 1. Handle CORS Preflight (OPTIONS) Requests ---
    // This logic is identical and works perfectly on Vercel Edge.
    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
            },
        });
    }

    // --- 2. Rate Limiting (Demonstration Only) ---
    // MODIFIED: Use Vercel's 'request.ip' helper instead of parsing headers.
    // NOTE: This in-memory solution remains STATELESS and will NOT work
    // reliably. This is just for feature parity with your demo.
    const ip = request.ip || "unknown";

    const now = Date.now();
    const windowStart = now - 60_000; // 1-minute sliding window

    // Filter out old timestamps and check the count
    const timestamps = (ipMap.get(ip) || []).filter(t => t > windowStart);
    if (timestamps.length >= RATE_LIMIT) {
        return new Response("Too many requests", { status: 429 });
    }
    timestamps.push(now);
    ipMap.set(ip, timestamps);


    // --- 3. Extract API Key from Header and Validate Body ---
    // This logic is identical and works perfectly on Vercel Edge.
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Missing or invalid Authorization header." }), {
            status: 401,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }

    let body;
    try {
        // We clone the request just as before.
        const requestClone = request.clone(); 
        body = await requestClone.json();
        if (!body.model) {
            throw new Error("Missing 'model' in request body");
        }
    } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message || "Invalid or empty JSON body" }), {
            status: 400,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }

    // --- 4. Forward the Request to the Target API (Stealth Mode) ---
    // This logic is identical and works perfectly on Vercel Edge.
    const targetUrl = "https://api.electronhub.ai/v1/chat/completions";

    const outgoingHeaders = new Headers();
    outgoingHeaders.set("Content-Type", "application/json");
    outgoingHeaders.set("Authorization", authHeader); // Forward the original auth header

    // Intelligently forward client headers
    const headersToForward = [
        'User-Agent',
        'Accept',
        'Accept-Language',
        'Accept-Encoding',
    ];

    headersToForward.forEach(headerName => {
        const headerValue = request.headers.get(headerName);
        if (headerValue) {
            outgoingHeaders.set(headerName, headerValue);
        }
    });

    const fetchOptions: RequestInit = {
        method: "POST",
        headers: outgoingHeaders, 
        body: JSON.stringify(body),
    };

    // ... inside your handle function ...

    try {
        const targetResponse = await fetch(targetUrl, fetchOptions);
        
        // Clone the response to modify headers
        const response = new Response(targetResponse.body, targetResponse);

        // --- START OF FIX ---

        // 1. Set the CORS header (this was already correct)
        response.headers.set("Access-Control-Allow-Origin", "*");
        
        // 2. Proactively delete any upstream CSP header.
        // This prevents the target API from breaking your frontend.
        response.headers.delete("Content-Security-Policy");

        // 3. You might as well delete this one too, just in case.
        response.headers.delete("X-Content-Security-Policy");

        // --- END OF FIX ---

        return response;

    } catch (error) {
        console.error("Target API Fetch Failed:", error);
        return new Response(JSON.stringify({ error: "Failed to connect to the target API" }), {
            status: 502,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }
}