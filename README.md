# PULSO público

Distribución estática y actualizador de datos permitidos. El repositorio de desarrollo y su historial permanecen privados. No contiene observaciones de la API INA/PNA, originales privados, credenciales ni archivos importados por usuarios.

Sitio: https://agustin21089.github.io/pulso-publico/

El workflow consulta SNIH/RHN Rosario, ONS Itaipú y la referencia portuaria IGN cada día a las 07:37 de Argentina (10:37 UTC), valida el corte y publica mediante GitHub Pages. También permite ejecución manual. Ante un error de fuente no despliega: conserva la web anterior. Las fechas de observación y extracción se muestran en pantalla. El cron puede demorarse o ser desactivado por GitHub tras 60 días sin actividad; revisar Actions y ejecutar manualmente si sucede.

SNIH es telemetría sin validar. Se selecciona la lectura real de 03:00 UTC, medianoche de Argentina, sin interpolar. El objetivo de 5m procede de IGN/PNA; su vigencia y equivalencia de escala con SNIH no están confirmadas. Las fechas de cruce son hipótesis de ritmo constante, sin validación hidrológica ni probabilidades de inundación.

Datos SNIH: https://snih.hidricosargentina.gob.ar/Terminos.aspx · SIPH/RHN, conservar atribución y fechas. ONS: Creative Commons Atribuição, catálogo https://dados.ons.org.br/dataset/dados-hidrologicos-res . Referencia de puerto: IGN/PNA, libre uso con cita IGN, https://riesgo.ign.gob.ar/metadatos/puertos_alturas_riesgo.pdf . Natural Earth: dominio público. Código PULSO: MIT; dependencias con licencias propias en site/licenses.

Usa runners estándar públicos, Pages y retención de artefacto de un día; no hay backend permanente, API paga ni dominio comprado. Aplican cuotas y términos de GitHub, y el almacenamiento compartido con otros proyectos de la cuenta. No se habilitan gastos adicionales ni se promete capacidad ilimitada.

Configuración: Settings → Pages → GitHub Actions. Workflow: Publicar PULSO y actualizar observaciones.

Revisión de desarrollo del paquete: 84703cbe7af82818b5f99ffff0504030456d8de2.
