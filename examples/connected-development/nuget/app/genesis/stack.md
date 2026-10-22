## Connected development

- Default package type: `nuget`
- Sources file: `.development/connected.json`
- Prepare `Use connected NuGet packages` with `csharp`: `dotnet` `run` `--project` `tooling/Connected` `--` `prepare` `.development/connected.json`
- Verify `Prove connected NuGet packages` with `csharp`: `dotnet` `run` `--project` `tooling/Connected` `--` `verify` `.development/connected.json`
