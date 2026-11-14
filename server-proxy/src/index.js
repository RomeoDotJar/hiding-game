export default {
  async fetch(request, env) {
    // 1. Define CORS headers for all responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // Restrict to your GitHub Pages URL in production
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 2. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 3. Prevent 500 errors on favicon requests
    if (url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // 4. Wrap everything in try/catch to prevent generic 500s
    try {
      const token = env.EDGEGAP_TOKEN;
      if (!token) throw new Error("EDGEGAP_TOKEN is missing in environment variables.");

      const authHeaders = {
        "Authorization": `token ${token}`,
        "Content-Type": "application/json",
      };

      const appName = "hiding-game";
      const appVersion = env.VERSION; // UPDATE THIS TAG whenever you deploy a new Edgegap version!

      // Helper function to find the active deployment
      async function getActiveDeployment() {
        const queryObj = {
          filters: [
            { field: "application", operator: "eq", value: appName },
            { field: "status", operator: "eq", value: "ready" }
          ]
        };
        const encodedQuery = encodeURIComponent(JSON.stringify(queryObj));
        const listRes = await fetch(`https://api.edgegap.com/v1/deployments?query=${encodedQuery}`, { headers: authHeaders });
        
        const listText = await listRes.text();
        if (!listRes.ok) throw new Error(`Edgegap List API error (${listRes.status}): ${listText}`);
        
        const listData = JSON.parse(listText);
        return listData.data && listData.data.length > 0 ? listData.data[0] : null;
      }

      // ==========================================
      // ROUTE: /get-server
      // ==========================================
      if (url.pathname === "/get-server") {
        const activeDeployment = await getActiveDeployment();

        if (activeDeployment) {
          // Find the external port for the Colyseus server (port 2567)
          let externalPort = null;
          if (activeDeployment.ports) {
            for (const key in activeDeployment.ports) {
              const portData = activeDeployment.ports[key];
              if (portData.internal === 2567 || portData.name === "gameport") {
                externalPort = portData.external;
                break;
              }
            }
          }

          if (externalPort) {
            const serverUrl = `wss://${activeDeployment.fqdn}:${externalPort}`;
            return new Response(JSON.stringify({ url: serverUrl }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } else {
            throw new Error("Active deployment found, but could not find the game port (2567).");
          }
        }

        // No active deployment found. Create a new one.
        console.log("No active deployments found. Creating a new one...");
        
        const createRes = await fetch("https://api.edgegap.com/v2/deployments", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            application: appName,
            version: appVersion,
            users: [
              {
                user_type: "ip_address",
                user_data: { ip_address: "0.0.0.0" } // Required by Edgegap
              }
            ]
          }),
        });

        const createText = await createRes.text();
        if (!createRes.ok) throw new Error(`Edgegap Create API error (${createRes.status}): ${createText}`);

        return new Response(JSON.stringify({ status: "deploying" }), {
          status: 202, // 202 Accepted
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ==========================================
      // ROUTE: /get-uptime
      // ==========================================
      if (url.pathname === "/get-uptime") {
        const activeDeployment = await getActiveDeployment();

        if (!activeDeployment) {
          throw new Error("No active deployment found to check uptime.");
        }

        const requestId = activeDeployment.request_id;
        
        // Fetch detailed status for this specific deployment
        const statusRes = await fetch(`https://api.edgegap.com/v1/status/${requestId}`, { headers: authHeaders });
        const statusText = await statusRes.text();
        
        if (!statusRes.ok) throw new Error(`Edgegap Status API error (${statusRes.status}): ${statusText}`);
        
        const statusData = JSON.parse(statusText);

        // Calculate remaining time
        const elapsedSeconds = statusData.elapsed_time || 0;
        const maxDurationMinutes = statusData.max_duration || 60;
        const maxDurationSeconds = maxDurationMinutes * 60;
        const remainingSeconds = Math.max(0, maxDurationSeconds - elapsedSeconds);

        return new Response(JSON.stringify({ 
          remainingSeconds: remainingSeconds,
          maxDurationMinutes: maxDurationMinutes 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ==========================================
      // Fallback for unknown routes
      // ==========================================
      return new Response(JSON.stringify({ error: "Route not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (error) {
      // Log the real error to Cloudflare's terminal
      console.error("Worker Error:", error.message);
      
      // Send the real error to the browser
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};