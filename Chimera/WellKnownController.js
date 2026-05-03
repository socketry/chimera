export const CHIMERA_BOOKMARKS_REFRESH_PATH = "/.well-known/chimera/bookmarks/refresh";
export const CHIMERA_CONFIGURATION_REFRESH_PATH = "/.well-known/chimera/configuration/refresh";

export class WellKnownController {
	constructor(delegate) {
		this.delegate = delegate;
		this.routes = new Map([
			[CHIMERA_BOOKMARKS_REFRESH_PATH, {
				methods: new Set(["POST"]),
				handle: this.handleBookmarksRefresh.bind(this),
			}],
			[CHIMERA_CONFIGURATION_REFRESH_PATH, {
				methods: new Set(["POST"]),
				handle: this.handleConfigurationRefresh.bind(this),
			}],
		]);
	}

	handleRequest({request, path}) {
		const route = this.routes.get(path);
		if (!route) {
			return null;
		}

		const method = (request.method || "GET").toUpperCase();
		if (!route.methods.has(method)) {
			return this.methodNotAllowed(route.methods);
		}

		return route.handle();
	}

	handleBookmarksRefresh() {
		this.delegate?.wellKnownControllerDidRequestBookmarksRefresh?.(this);
		return new Response(null, {status: 204});
	}

	handleConfigurationRefresh() {
		this.delegate?.wellKnownControllerDidRequestConfigurationRefresh?.(this);
		return new Response(null, {status: 204});
	}

	methodNotAllowed(methods) {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: {
				allow: Array.from(methods).join(", "),
				"content-type": "text/plain; charset=utf-8",
			},
		});
	}
}
