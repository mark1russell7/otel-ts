# Roadmap

This file is the plan of otel-ts. The Status page of the site reads it.

| ID | Item | Status | Summary |
| --- | --- | --- | --- |
| O1 | The site with a live lab | done | The site at GitHub Pages starts the real `init()` in the browser. A stub in the page catches each OTLP export, and the page shows it in a waterfall and on a wire. |
| O2 | Faro in the lab | not started | Faro stays off in the lab, because its tracing adds a second copy of each fetch span. A later lab can show a Faro lane with no second copy. |
