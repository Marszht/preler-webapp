# Repository Guidelines
## Project Structure
This is a minimal Node.js + vanilla JS web application for perler bead pattern generation:
- `server.js`: Express backend entry point, handles image processing API endpoints
- `public/`: Frontend static assets (HTML, CSS, client-side JS)
- `lib/`: Shared core modules (color quantization algorithm, palette definitions, rendering logic)

## Development Commands
- `npm install`: Install all production dependencies
- `node server.js`: Start local development server on port 3000
- `npm ci`: Reproducible dependency install for deployment environments

## Coding Style
- 2-space indentation for all JS/HTML/CSS files
- Use camelCase for variable/function naming
- Add short descriptive comments for non-trivial algorithm logic
- No linting/formatting tools are enforced for this small project

## Commit Guidelines
Follow simple conventional commit format:
`<type>: <description>`
Types: `fix` (bug fixes), `feat` (new features), `docs` (documentation), `refactor` (code improvements)
Example: `fix: resolve 404 errors on Vercel static asset paths`

## Deployment Notes
- The repository includes pre-configured `vercel.json` for one-click Vercel deployment
- No build step is required, deployment uses standard `npm install` + `npm start` flow
- All image processing runs in-memory, no persistent storage required
