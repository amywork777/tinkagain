# Important Commands and Workflows

## Git Commands
- Always push changes to GitHub after completing a fix: `git add . && git commit -m "message" && git push`

## API Routes
- When adding new API routes, ensure they are properly configured in `vercel.json`
- API routes should be TypeScript files in the `/api` directory for Vercel deployment
- Local development uses the server directory but production uses api directory

## Common Issues
- Vercel only processes TypeScript files in the api/ directory by default
- Frontend client requests to API routes must match the paths defined in vercel.json

## Project Structure
- Frontend: React app in client/src
- Backend APIs: Serverless functions in api/
- Local development server: Node.js server in server/