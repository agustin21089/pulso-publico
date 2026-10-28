# PULSO público

Atlas hidrológico y actualizador diario gratuito. Sitio: https://agustin21089.github.io/pulso-publico/

Cobertura del paquete: 49 series, 4319 observaciones de altura, desde 2026-08-01 hasta 2026-10-27. Incluye 48 estaciones INA/PNA (las 38 originales, seis del Paraná–Iguazú y cuatro del Paraguay), represas de referencia WRI / CC BY 4.0, ONS Itaipú y Rosario INA/PNA como única serie de Rosario. También incluye 87 días de caudal medio diario afluente y efluente de Yacyretá (INA 26684/26685), con procedencia e intervalo por variable. No se interpolan vacíos.

El workflow consulta INA/PNA, última lectura directa PNA Rosario, ONS, medias diarias INA de Yacyretá a las 07:37, 13:37 y 19:37 de Argentina (10:37, 16:37 y 22:37 UTC), valida y publica mediante Pages. Ante un fallo conserva el despliegue anterior. Las fechas de observación y extracción aparecen en pantalla. La programación puede demorarse o desactivarse tras 60 días sin actividad; permite ejecución manual.

INA/PNA: datos factuales públicos publicados con autorización expresa del responsable de PULSO; atribución y procedencia conservadas. No se afirma una licencia específica de redistribución confirmada. Fuente: https://alerta.ina.gob.ar/a5/apiUI . ONS: Creative Commons Atribuição, https://dados.ons.org.br/dataset/dados-hidrologicos-res . Referencias IGN: libre uso con cita, https://riesgo.ign.gob.ar/metadatos/puertos_alturas_riesgo.pdf . Natural Earth: dominio público. Código: MIT; dependencias en site/licenses.

Las fechas de cruce son hipótesis de ritmo sostenido, sin validación hidrológica ni probabilidades de inundación. Los umbrales de catálogo no tienen vigencia histórica confirmada.

No contiene originales de ingesta, credenciales, historial privado ni archivos importados por usuarios. Usa runners estándar públicos, Pages y artefacto con retención de un día; no habilita gastos adicionales. Aplican cuotas gratuitas de GitHub.

Configuración: Settings → Pages → GitHub Actions. Workflow: Publicar PULSO y actualizar observaciones.

Revisión de desarrollo: f26695182ce46416e0c0dd3f12f34e43cffa3019.
