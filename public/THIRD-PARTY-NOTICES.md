# Third party notices

Zappa TV itself is MIT licensed, and its terms are in [LICENSE](../LICENSE). The software below is
other people's work, and this file exists because some of it travels inside every widget this
project builds rather than staying in the repository.

It lives in `public/` deliberately. Vite copies that directory verbatim, so the file and the licence
texts beside it end up in `dist/` and therefore inside the `.wgt` that a television installs. Recipients need the applicable licence texts with the shipped software; repository-only notices
would not accompany an installed package.

## Shipped inside the application

**Lucide Icons**, SVG icon geometry from the Lucide project, ISC License, Copyright 2026 Lucide Icons and Contributors. Some icons derive from Feather Icons under the MIT License, Copyright 2013-present Cole Bemis. The application embeds the selected SVG paths directly without the Lucide runtime package. The licence texts and attribution are in [licenses/lucide.txt](licenses/lucide.txt).

**React** and **React DOM**, version 19.3.0, MIT, Copyright Meta Platforms, Inc. and affiliates.
Text in [licenses/react.txt](licenses/react.txt), which covers both packages.

**zustand**, version 5.0.15, MIT, Copyright 2019 Paul Henschel. Text in
[licenses/zustand.txt](licenses/zustand.txt).

**uqr**, version 0.1.3, MIT, Copyright Project Nayuki and Anthony Fu. It generates pairing QR codes locally so no setup information leaves the television. Text in [licenses/uqr.txt](licenses/uqr.txt).

**Google Sans**, Regular and SemiBold script subsets, SIL Open Font License 1.1, Copyright 2025 The Google Sans Project Authors. The bundled Latin/Latin Extended subsets provide Latin text including Swedish. Other scripts use firmware-dependent system fallbacks. The faces are declared in `public/fonts/fonts.css`. The licence text is in [licenses/OFL-Google-Sans.txt](licenses/OFL-Google-Sans.txt).

**Vazirmatn**, Regular and SemiBold fonts, SIL Open Font License 1.1, Copyright 2015 The Vazirmatn Project Authors. The fonts provide the Arabic and Persian interfaces in `public/fonts/fonts.css`. The licence text is in [licenses/OFL.txt](licenses/OFL.txt).

**Historical Noto Sans CJK attribution:** bundled CJK web sets were removed under the Latin/Arabic font policy. Other-script glyph coverage depends on TV system fonts. The prior SIL Open Font License 1.1 text, Copyright 2014 to 2021 Adobe, is retained in [licenses/OFL-Noto-Sans-CJK.txt](licenses/OFL-Noto-Sans-CJK.txt) for provenance; no Noto CJK web font is shipped.

**Emscripten**, MIT and University of Illinois NCSA, Copyright the Emscripten authors. The file `wasm/manifest-socket.js` is generated glue, and rather than being compiled output in the way a binary is, most of it is copied from Emscripten's own JavaScript libraries, so its licence follows it here. It was produced by Samsung's fork of Emscripten, whose Tizen extensions carry the same two licences. The management module is compiled by current Emscripten and uses a small project owned loader. Both build recipes are in [the testing documentation](../docs/testing.md).

**musl libc**, MIT, Copyright 2005 to 2020 Rich Felker and contributors. Linked into both WebAssembly modules by Emscripten, which uses musl for its C library.

## Development only, not shipped

TypeScript, Vite, Vitest, Biome, React Testing Library and their dependencies are build tools. None
of them is part of the widget, so none of them is listed here. `package.json` and
`package-lock.json` record them exactly.

## Keeping this honest

Nothing generates this file, so a new runtime dependency has to be added by hand, and
[AGENTS.md](../AGENTS.md) says so among the invariants. There are four runtime dependencies and
adding one is a deliberate decision rather than a detail, so the cost of doing it by hand is lower
than the cost of a generator nobody reads the output of.
