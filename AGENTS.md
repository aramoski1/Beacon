<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:page-guides -->
# Keep broker how-to pages current

User-visible ships must update, in the **same commit**:

- `lib/page-guides.ts` (How Beacon works + the floating ? on each page)
- `app/how-beacon-works/page.tsx` Day-1 path and Honest limits when those change
- `app/copilot/actions.ts` platform knowledge (paths, buttons, and “does NOT have”)

Do not push a new control or a new limitation while those pages still describe the old product. See `.cursor/rules/keep-page-guides-current.mdc`.
<!-- END:page-guides -->
