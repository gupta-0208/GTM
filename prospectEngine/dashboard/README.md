# Prospect Engine dashboard

The React and Vite dashboard runs against the local Prospect Engine API.

## Start the full local app

From the `prospectEngine` directory:

```bash
docker compose --profile ui up --build -d
```

Open [http://localhost:5173](http://localhost:5173). The dashboard submits a
finder job and runs discovery, crawling, and extraction in sequence. Its run
panel shows the active stage, generated search queries, and a completion
summary. The tables show the latest saved company and contact records, and
company records can be exported to CSV.

Use **Add product** to save a product name, description, ideal customer,
company types, industries, and location. Choose a profile before running the
finder; the profile is saved in this browser and applied to search and
qualification. Use **All products** in the records filter to compare results
across finder runs. Older records without product metadata appear as
**Unassigned legacy**.

Use **Test Google search** to query the self-hosted SearXNG service without
starting a finder run. It shows which configured engines returned results and
which were blocked or rate-limited. Set `SEARXNG_ENGINES` in `.env` to choose
an upstream engine. SearXNG is open source and runs locally, but upstream
search engines can still throttle or block automated requests.

The finder uses SearXNG, then crawls the returned company websites. Cached
results can be reused for 30 days unless `SEARXNG_BYPASS_CACHE=true`.

## Run only the UI in development

With the API already available at `http://localhost:3000`:

```bash
npm install
npm run dev
```

Vite proxies `/api` requests to the local API. To create a production bundle,
run `npm run build`.
