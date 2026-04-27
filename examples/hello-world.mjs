import {Application} from "@socketry/htty";

Application.open(() => ({
	status: 200,
	headers: {"content-type": "text/plain; charset=utf-8"},
	body: "Hello World from HTTY\n",
}));
