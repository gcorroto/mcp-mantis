# Specification

## Requirement: Publicación npm desde CI

As a library maintainer, I want Jenkins to manage npm releases, so that versioning follows a consistent process.

#### Scenario: Pipeline de publicación

- GIVEN el repositorio preparado para Jenkins
- WHEN se inspecciona el Jenkinsfile de la raíz
- THEN contiene exactamente `@Library('jenkins-voip-reporter@main') _` y `publishNpmLibrary()` en líneas consecutivas

#### Scenario: Patch automático

- GIVEN un push a main que no contiene ya un cambio de versión
- WHEN Jenkins ejecuta la publicación
- THEN incrementa el patch, crea el commit `chore(release): vX.Y.Z [ci skip]` y el tag `vX.Y.Z`, y publica en npm

#### Scenario: Minor o major manual

- GIVEN una versión minor o major preparada con el script correspondiente
- WHEN el commit de versión llega a main
- THEN Jenkins publica esa versión sin volver a incrementarla y crea su tag

#### Scenario: Scripts de versión y publicación

- GIVEN los scripts de package.json
- WHEN se ejecuta `release:minor` o `release:major`
- THEN incrementa la versión correspondiente, crea el commit `chore(release): vX.Y.0` sin `[ci skip]` y hace push sin publicar ni crear tags
- AND no existen `release:patch` ni `prerelease`, y ningún script ejecuta `npm publish` ni hace push de versiones mediante tags
- AND los scripts `version:patch`, `version:minor` y `version:major` permanecen sin cambios

#### Scenario: Versión del cambio

- GIVEN la versión de package.json anterior a este cambio
- WHEN se revisa el cambio
- THEN el campo `version` permanece sin modificar

## Requirement: Comprobación integral

As a library maintainer, I want `check` to include tests and build, so that the package is validated before publication.

#### Scenario: Ejecución de check

- GIVEN las dependencias necesarias instaladas
- WHEN se ejecuta `npm run check`
- THEN se ejecutan secuencialmente typecheck, lint, format:check y npm test, que incluye build
- AND la ausencia de la dependencia opcional `@huggingface/transformers` no rompe check

## Requirement: Instrucciones de release

As a maintainer, I want release instructions, so that CI is the sole publisher.

#### Scenario: Documentación del proceso

- GIVEN la sección Releasing del README
- WHEN un mantenedor consulta el procedimiento
- THEN explica en cuatro líneas el patch automático en CI, los comandos `npm run release:minor` y `npm run release:major`, y que solo CI publica en npm, sin describir el pipeline por dentro
