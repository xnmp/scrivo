// Grammars for fenced code blocks, each loaded on first use.
//
// A curated replacement for @codemirror/language-data: that package's Markdown entry
// lazily calls lang-markdown's `markdown()`, which drags the HTML, CSS and JavaScript
// grammars into the startup bundle (~150 KB). Nested markdown uses our own grammar.
import { LanguageDescription, LanguageSupport, StreamLanguage, type StreamParser } from '@codemirror/language';

const legacy = <T>(parser: StreamParser<T>) => new LanguageSupport(StreamLanguage.define(parser));

type Spec = { name: string; alias?: string[]; extensions?: string[]; load: () => Promise<LanguageSupport> };
const lang = (spec: Spec) => LanguageDescription.of(spec);

export function codeLanguages(markdown: () => LanguageSupport): readonly LanguageDescription[] {
  return [
    lang({ name: 'Markdown', alias: ['md', 'mkd'], extensions: ['md', 'markdown'], load: async () => markdown() }),
    lang({ name: 'JavaScript', alias: ['js', 'node', 'ecmascript'], extensions: ['js', 'mjs', 'cjs'], load: () => import('@codemirror/lang-javascript').then((m) => m.javascript()) }),
    lang({ name: 'TypeScript', alias: ['ts'], extensions: ['ts', 'mts', 'cts'], load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })) }),
    lang({ name: 'JSX', extensions: ['jsx'], load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })) }),
    lang({ name: 'TSX', extensions: ['tsx'], load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })) }),
    lang({ name: 'JSON', alias: ['json5', 'jsonc'], extensions: ['json', 'map'], load: () => import('@codemirror/lang-json').then((m) => m.json()) }),
    lang({ name: 'Python', alias: ['py', 'python3'], extensions: ['py', 'pyw', 'pyi'], load: () => import('@codemirror/lang-python').then((m) => m.python()) }),
    lang({ name: 'Rust', alias: ['rs'], extensions: ['rs'], load: () => import('@codemirror/lang-rust').then((m) => m.rust()) }),
    lang({ name: 'Go', alias: ['golang'], extensions: ['go'], load: () => import('@codemirror/lang-go').then((m) => m.go()) }),
    lang({ name: 'Java', extensions: ['java'], load: () => import('@codemirror/lang-java').then((m) => m.java()) }),
    lang({ name: 'C', extensions: ['c', 'h'], load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()) }),
    lang({ name: 'C++', alias: ['cpp', 'cxx'], extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh'], load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()) }),
    lang({ name: 'PHP', extensions: ['php'], load: () => import('@codemirror/lang-php').then((m) => m.php()) }),
    lang({ name: 'HTML', alias: ['xhtml'], extensions: ['html', 'htm'], load: () => import('@codemirror/lang-html').then((m) => m.html()) }),
    lang({ name: 'CSS', extensions: ['css'], load: () => import('@codemirror/lang-css').then((m) => m.css()) }),
    lang({ name: 'SCSS', extensions: ['scss'], load: () => import('@codemirror/lang-sass').then((m) => m.sass()) }),
    lang({ name: 'Sass', extensions: ['sass'], load: () => import('@codemirror/lang-sass').then((m) => m.sass({ indented: true })) }),
    lang({ name: 'XML', alias: ['svg', 'rss', 'plist'], extensions: ['xml', 'svg', 'xsd', 'xsl'], load: () => import('@codemirror/lang-xml').then((m) => m.xml()) }),
    lang({ name: 'YAML', alias: ['yml'], extensions: ['yaml', 'yml'], load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()) }),
    lang({ name: 'SQL', extensions: ['sql'], load: () => import('@codemirror/lang-sql').then((m) => m.sql()) }),
    lang({ name: 'PostgreSQL', alias: ['postgres', 'psql', 'pgsql'], load: () => import('@codemirror/lang-sql').then((m) => m.sql({ dialect: m.PostgreSQL })) }),
    lang({ name: 'MySQL', load: () => import('@codemirror/lang-sql').then((m) => m.sql({ dialect: m.MySQL })) }),
    lang({ name: 'SQLite', load: () => import('@codemirror/lang-sql').then((m) => m.sql({ dialect: m.SQLite })) }),

    lang({ name: 'Shell', alias: ['bash', 'sh', 'zsh', 'console', 'shellsession'], extensions: ['sh', 'bash', 'zsh'], load: () => import('@codemirror/legacy-modes/mode/shell').then((m) => legacy(m.shell)) }),
    lang({ name: 'PowerShell', alias: ['ps1', 'pwsh'], extensions: ['ps1', 'psm1'], load: () => import('@codemirror/legacy-modes/mode/powershell').then((m) => legacy(m.powerShell)) }),
    lang({ name: 'TOML', extensions: ['toml'], load: () => import('@codemirror/legacy-modes/mode/toml').then((m) => legacy(m.toml)) }),
    lang({ name: 'INI', alias: ['properties', 'conf', 'cfg'], extensions: ['ini', 'properties'], load: () => import('@codemirror/legacy-modes/mode/properties').then((m) => legacy(m.properties)) }),
    lang({ name: 'Dockerfile', alias: ['docker'], load: () => import('@codemirror/legacy-modes/mode/dockerfile').then((m) => legacy(m.dockerFile)) }),
    lang({ name: 'Diff', alias: ['patch'], extensions: ['diff', 'patch'], load: () => import('@codemirror/legacy-modes/mode/diff').then((m) => legacy(m.diff)) }),
    lang({ name: 'Nginx', load: () => import('@codemirror/legacy-modes/mode/nginx').then((m) => legacy(m.nginx)) }),
    lang({ name: 'CMake', load: () => import('@codemirror/legacy-modes/mode/cmake').then((m) => legacy(m.cmake)) }),
    lang({ name: 'Protobuf', alias: ['proto'], extensions: ['proto'], load: () => import('@codemirror/legacy-modes/mode/protobuf').then((m) => legacy(m.protobuf)) }),
    lang({ name: 'Lua', extensions: ['lua'], load: () => import('@codemirror/legacy-modes/mode/lua').then((m) => legacy(m.lua)) }),
    lang({ name: 'Ruby', alias: ['rb'], extensions: ['rb'], load: () => import('@codemirror/legacy-modes/mode/ruby').then((m) => legacy(m.ruby)) }),
    lang({ name: 'Perl', alias: ['pl'], extensions: ['pl', 'pm'], load: () => import('@codemirror/legacy-modes/mode/perl').then((m) => legacy(m.perl)) }),
    lang({ name: 'R', extensions: ['r'], load: () => import('@codemirror/legacy-modes/mode/r').then((m) => legacy(m.r)) }),
    lang({ name: 'Swift', extensions: ['swift'], load: () => import('@codemirror/legacy-modes/mode/swift').then((m) => legacy(m.swift)) }),
    lang({ name: 'Kotlin', alias: ['kt'], extensions: ['kt', 'kts'], load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => legacy(m.kotlin)) }),
    lang({ name: 'C#', alias: ['csharp', 'cs'], extensions: ['cs'], load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => legacy(m.csharp)) }),
    lang({ name: 'Scala', extensions: ['scala'], load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => legacy(m.scala)) }),
    lang({ name: 'Dart', extensions: ['dart'], load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => legacy(m.dart)) }),
    lang({ name: 'Objective-C', alias: ['objc', 'objective-c'], extensions: ['m'], load: () => import('@codemirror/legacy-modes/mode/clike').then((m) => legacy(m.objectiveC)) }),
    lang({ name: 'Haskell', alias: ['hs'], extensions: ['hs'], load: () => import('@codemirror/legacy-modes/mode/haskell').then((m) => legacy(m.haskell)) }),
    lang({ name: 'OCaml', alias: ['ml'], extensions: ['ml', 'mli'], load: () => import('@codemirror/legacy-modes/mode/mllike').then((m) => legacy(m.oCaml)) }),
    lang({ name: 'F#', alias: ['fsharp'], extensions: ['fs', 'fsx'], load: () => import('@codemirror/legacy-modes/mode/mllike').then((m) => legacy(m.fSharp)) }),
    lang({ name: 'Clojure', alias: ['clj'], extensions: ['clj', 'cljs', 'edn'], load: () => import('@codemirror/legacy-modes/mode/clojure').then((m) => legacy(m.clojure)) }),
    lang({ name: 'Scheme', alias: ['racket'], extensions: ['scm', 'ss', 'rkt'], load: () => import('@codemirror/legacy-modes/mode/scheme').then((m) => legacy(m.scheme)) }),
    lang({ name: 'Erlang', extensions: ['erl'], load: () => import('@codemirror/legacy-modes/mode/erlang').then((m) => legacy(m.erlang)) }),
    lang({ name: 'Julia', alias: ['jl'], extensions: ['jl'], load: () => import('@codemirror/legacy-modes/mode/julia').then((m) => legacy(m.julia)) }),
    lang({ name: 'Groovy', alias: ['gradle'], extensions: ['groovy', 'gradle'], load: () => import('@codemirror/legacy-modes/mode/groovy').then((m) => legacy(m.groovy)) }),
    lang({ name: 'LaTeX', alias: ['tex'], extensions: ['tex', 'sty', 'cls'], load: () => import('@codemirror/legacy-modes/mode/stex').then((m) => legacy(m.stex)) }),
    lang({ name: 'Verilog', extensions: ['v', 'sv'], load: () => import('@codemirror/legacy-modes/mode/verilog').then((m) => legacy(m.verilog)) }),
    lang({ name: 'VHDL', extensions: ['vhd', 'vhdl'], load: () => import('@codemirror/legacy-modes/mode/vhdl').then((m) => legacy(m.vhdl)) }),
    lang({ name: 'Elm', extensions: ['elm'], load: () => import('@codemirror/legacy-modes/mode/elm').then((m) => legacy(m.elm)) }),
    lang({ name: 'Fortran', extensions: ['f', 'f90', 'f95'], load: () => import('@codemirror/legacy-modes/mode/fortran').then((m) => legacy(m.fortran)) }),
    lang({ name: 'Pascal', alias: ['delphi'], extensions: ['pas', 'p'], load: () => import('@codemirror/legacy-modes/mode/pascal').then((m) => legacy(m.pascal)) }),
    lang({ name: 'Octave', alias: ['matlab'], load: () => import('@codemirror/legacy-modes/mode/octave').then((m) => legacy(m.octave)) }),
    lang({ name: 'HTTP', load: () => import('@codemirror/legacy-modes/mode/http').then((m) => legacy(m.http)) }),
  ];
}
