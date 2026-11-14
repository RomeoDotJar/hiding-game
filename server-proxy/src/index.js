export default {
	async fetch(request, env) {
		const allowedOrigins = [
			"https://romeodotjar.github.io",
			"http://localhost:8080",
			"http://localhost:5173" // Vite's default local port (just in case)
		];

		const origin = request.headers.get("Origin");

		var corsHeaders = {};

		// Check if the request's origin is in our allowed list
		if (allowedOrigins.includes(origin)) {
			corsHeaders = {
				"Access-Control-Allow-Origin": origin,
				"Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Authorization",
				"Access-Control-Allow-Methods": "OPTIONS, POST, GET",
			};
		}
		else
			corsHeaders = {
				"Access-Control-Allow-Origin": '',
				"Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Authorization",
				"Access-Control-Allow-Methods": "OPTIONS, POST, GET",
			};

		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		const edgegapToken = env.EDGEGAP_TOKEN;
		const appName = "hiding-game";
		const appVersion = env.VERSION; // Update this tag when you deploy a new version

		const authHeaders = {
			"Authorization": `token ${edgegapToken}`,
			"Content-Type": "application/json",
		};

		// 1. Check for active deployments
		// API: GET /v1/deployments
		// Build the query as an object
		const query = {
			filters: [
				{ field: "application", operator: "eq", value: appName },
				{ field: "status", operator: "eq", value: "ready" } // Use "ready" or "active"
			],
			// It's good practice to order results
			order_by: [{ field: "created_at", order: "desc" }]
		};

		// Encode the JSON object for the URL
		const encodedQuery = encodeURIComponent(JSON.stringify(query));
		const listUrl = `https://api.edgegap.com/v1/deployments?query=${encodedQuery}`;

		const listRes = await fetch(listUrl, { headers: authHeaders });
		const listData = await listRes.json();

		if (listData.data && listData.data.length > 0) {
			const activeDeployment = listData.data[0];
			let externalPort = null;

			// Edgegap returns ports as an object keyed by port name (e.g., "gameport")
			if (activeDeployment.ports) {
				for (const key in activeDeployment.ports) {
					const portData = activeDeployment.ports[key];
					// Check if this is the Colyseus port
					if (portData.internal === 2567 || portData.name === "gameport") {
						externalPort = portData.external;
						break;
					}
				}
			}

			if (externalPort) {
				const serverUrl = `wss://${activeDeployment.fqdn}:${externalPort}`;
				return new Response(JSON.stringify({ url: serverUrl }), {
					headers: {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*"
					},
				});
			} else {
				throw new Error("Active deployment found, but could not find the game port (2567).");
			}
		}

		// 2. No active deployment found. Create a new one.
		// API: POST /v2/deployments
		const createRes = await fetch("https://api.edgegap.com/v2/deployments", {
			method: "POST",
			headers: authHeaders,
			body: JSON.stringify({
				application: appName,
				version: appVersion,
				// Add the required 'users' array
				users: [
					{
						user_type: "ip_address",
						user_data: { ip_address: "0.0.0.0" } // Or a real IP for better routing
					}
				]
			}),
		});

		const createData = await createRes.json();

		if (!createRes.ok) {
			return new Response(JSON.stringify({ error: createData.message }), { status: 500, headers: corsHeaders });
		}

		// 3. Return the new deployment status (you'll need to poll until it's ready)
		return new Response(JSON.stringify({
			status: "deploying",
			requestId: createData.request_id
		}), {
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	},
};