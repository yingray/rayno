# Third-party notices

## Happy source and Rayno overlay

The Rayno mark, provider images, workspace colors, and adapted protocol helpers derive from the Happy source
(https://github.com/slopus/happy) and from the author's earlier Rayno overlay for the Happy app.
See `src/happy/PROTOCOL-SOURCES.md` for the pinned upstream commit.
Happy uses the MIT license. The complete notice appears in `HAPPY-LICENSE.txt`.

Original source paths:

- `sources/rayno/raynoMarkPath.ts`
- `sources/rayno/workspaceColor.ts`
- `sources/assets/images/icon-claude@2x.png`
- `sources/assets/images/icon-gpt@2x.png`
- `sources/assets/images/logo-black.png`

Provider marks identify their respective providers. Their inclusion does not imply endorsement.

## Geist and Geist Mono

Font files come from the existing overlay, which identifies them as Geist 1.8.1 by Vercel.
They use the SIL Open Font License 1.1.
The complete font notice appears in `public/fonts/OFL-Geist.txt`.

## Ionicons

Ionicons 8.1.0 provides the interface icons.
The package uses the MIT license and includes its license with the installed dependency.
Icon source data remains bundled locally.

## Application dependencies

Mermaid previews use [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) 1.1.3 under the MIT license.
The complete notice appears in `public/licenses/beautiful-mermaid.txt`.
The renderer and its ELK layout dependency run locally in a Web Worker.

Code blocks use [lowlight](https://github.com/wooorm/lowlight) 3.3.0 and highlight.js under the MIT and BSD-3-Clause licenses.
The grammars load locally when code enters the viewport. React renders the token tree without executable HTML.
The complete notices appear in `public/licenses/lowlight.txt` and `public/licenses/highlight.js.txt`.

The package manifest and lockfile identify exact direct versions and resolved dependency versions.
The respective packages retain their source licenses.
