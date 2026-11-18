# Tasks

## 1. Configuración y documentación

- [ ] 1.1 Añadir en la raíz el Jenkinsfile con las dos líneas exactas indicadas en la incidencia (Scenario: Pipeline de publicación).
- [ ] 1.2 En package.json, eliminar `release:patch` y `prerelease`, establecer `check` como `npm run typecheck && npm run lint && npm run format:check && npm test`, y sustituir `release:minor` y `release:major` por los comandos exactos de la incidencia; conservar los scripts `version:*` y el campo `version` (Scenarios: Scripts de versión y publicación, Versión del cambio, Ejecución de check).
- [ ] 1.3 Actualizar la sección Releasing del README con el estándar en cuatro líneas, sin describir el interior del pipeline (Scenario: Documentación del proceso).

## 2. Verificación local

- [ ] 2.1 Revisar el contenido exacto del Jenkinsfile, los scripts y el README; comparar `version` y los scripts `version:*` con la base y verificar que ningún script publique ni haga push de tags (Scenarios: Pipeline de publicación, Scripts de versión y publicación, Versión del cambio, Documentación del proceso).
- [ ] 2.2 Instalar dependencias y ejecutar `npm run check`, que incluye build y tests; comprobar también que funciona sin la dependencia opcional `@huggingface/transformers` y documentar en el PR cualquier comprobación imposible en el sandbox (Scenario: Ejecución de check).

## Verificación tras el despliegue

- [ ] Verificar en Jenkins que un push a main produce el patch, commit con `[ci skip]`, tag y publicación esperados (Scenario: Patch automático).
- [ ] Verificar en Jenkins que un release minor o major llegado a main se publica sin un incremento adicional y recibe su tag (Scenario: Minor o major manual).
