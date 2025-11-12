// Import Vercel's Edge-compatible request object
import { type NextRequest } from 'next/server';

// Tell Vercel to run this as an Edge Function
export const config = {
    runtime: 'edge',
};

// The specific origin we are allowing
const ALLOWED_ORIGIN = "https://janitorai.com";

/*
    WARNING: This in-memory rate limiter is for demonstration only.
    It WILL NOT work reliably on Vercel Edge Functions.
    For a production-ready solution, use Vercel KV (@vercel/kv).
*/
const RATE_LIMIT = 60; // Max requests per minute per IP
const ipMap = new Map<string, number[]>(); // Using a Map for in-memory store

// The 'handle' function from Deno becomes the default export
export default async function handle(request: NextRequest): Promise<Response> {

    // --- 1. Handle CORS Preflight (OPTIONS) Requests ---
    //
    // THIS SECTION IS UPDATED TO BE DYNAMIC
    //
    if (request.method === "OPTIONS") {
        const headers = new Headers();
        
        // IMPORTANT: Set the specific origin
        headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
        headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");

        // Dynamically allow whatever headers the client is requesting
        const requestedHeaders = request.headers.get("Access-Control-Request-Headers");
        if (requestedHeaders) {
            headers.set("Access-Control-Allow-Headers", requestedHeaders);
        }

        // Allow credentials (e.g., cookies) if needed
        headers.set("Access-Control-Allow-Credentials", "true");

        return new Response(null, {
            status: 204, // 204 No Content is standard for preflight
            headers: headers,
        });
    }

    // --- 2. Rate Limiting (Demonstration Only) ---
    const ip = request.ip || "unknown";
    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = (ipMap.get(ip) || []).filter(t => t > windowStart);

    if (timestamps.length >= RATE_LIMIT) {
        return new Response("Too many requests", { 
            status: 429,
            // Add CORS headers to error responses too
            headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN }
        });
    }
    timestamps.push(now);
    ipMap.set(ip, timestamps);


    // --- 3. Extract API Key and Validate Body ---
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Missing or invalid Authorization header." }), {
            status: 401,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            },
        });
    }

    let body;
    try {
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
                "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            },
        });
    }

    // --- 4. Forward the Request to the Target API ---
    const targetUrl = "https://api.electronhub.ai/v1/chat/completions";

    const outgoingHeaders = new Headers();
    outgoingHeaders.set("Content-Type", "application/json");
    outgoingHeaders.set("Authorization", authHeader); 

    const headersToForward = [
        'User-Agent', 'Accept', 'Accept-Language', 'Accept-Encoding',
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

    try {
        const targetResponse = await fetch(targetUrl, fetchOptions);
        
        const response = new Response(targetResponse.body, targetResponse);

        // IMPORTANT: Set the specific origin
        response.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
        
        // Also allow credentials on the main response
        response.headers.set("Access-Control-Allow-Credentials", "true");

        // Clean up headers that can break the frontend
        response.headers.delete("Content-Security-Policy");
        response.headers.delete("X-Content-Security-Policy");

        return response;

    } catch (error) {
        console.error("Target API Fetch Failed:", error);
        return new Response(JSON.stringify({ error: "Failed to connect to the target API" }), {
            status: 502,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            },
        });
    }
}