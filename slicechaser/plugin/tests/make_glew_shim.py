#!/usr/bin/env python3
"""Linux test helper (usage: make_glew_shim.py plugin.so [more.so] out.cpp): FFGL only calls glewInit on Windows, so on Linux the plugin's
__glewXxx function pointers would stay null. This writes a C file defining every
__glew symbol the plugin imports, plus shim_glew_load() to fill them via EGL."""
import subprocess, sys

*plugins, out = sys.argv[1:]
funcs, flags = set(), set()
for plugin in plugins:
    nm = subprocess.run(["nm", "-D", "--undefined-only", plugin], capture_output=True, text=True, check=True).stdout
    for line in nm.splitlines():
        name = line.split()[-1].split("@")[0]
        if name.startswith("__glew"):
            funcs.add(name)
        elif name.startswith("__GLEW_"):
            flags.add(name)
funcs, flags = sorted(funcs), sorted(flags)

with open(out, "w") as f:
    f.write("#include <EGL/egl.h>\n#include <stdio.h>\n#ifdef __cplusplus\nextern \"C\" {\n#endif\n")
    for n in funcs:
        f.write(f"void* {n} = 0;\n")
    for n in flags:
        f.write(f"unsigned char {n} = 1;\n")
    f.write("int shim_glew_load(void) {\n  int missing = 0;\n")
    for n in funcs:
        gl = "gl" + n[len("__glew"):]
        f.write(f'  {n} = (void*)eglGetProcAddress("{gl}");\n')
        f.write(f'  if (!{n}) {{ fprintf(stderr, "missing {gl}\\n"); ++missing; }}\n')
    f.write("  return missing;\n}\n#ifdef __cplusplus\n}\n#endif\n")
print(f"shim: {len(funcs)} functions, {len(flags)} flags")
