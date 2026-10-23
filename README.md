# PULSO público

Atlas hidrológico y actualizador diario gratuito. Sitio: https://agustin21089.github.io/pulso-publico/

Cobertura del paquete: 40 series, 3366 observaciones de altura, desde 2026-08-01 hasta 2026-10-23. Incluye las 38 estaciones originales INA/PNA, ONS Itaipú y Rosario RHN/SNIH como serie independiente, sin afirmar equivalencia entre escalas. No se interpolan vacíos.

El workflow consulta INA/PNA, SNIH/RHN, ONS e IGN a las 07:37 de Argentina (10:37 UTC), valida y publica mediante Pages. Ante un fallo conserva el despliegue anterior. Las fechas de observación y extracción aparecen en pantalla. La programación puede demorarse o desactivarse tras 60 días sin actividad; permite ejecución manual.

INA/PNA: datos factuales públicos publicados con autorización expresa del responsable de PULSO; atribución y procedencia conservadas. No se afirma una licencia específica de redistribución confirmada. Fuente: https://alerta.ina.gob.ar/a5/apiUI . SNIH: telemetría sin validar, reutilización según https://snih.hidricosargentina.gob.ar/Terminos.aspx , atribución SIPH/RHN y fechas. ONS: Creative Commons Atribuição, https://dados.ons.org.br/dataset/dados-hidrologicos-res . Referencias IGN: libre uso con cita, https://riesgo.ign.gob.ar/metadatos/puertos_alturas_riesgo.pdf . Natural Earth: dominio público. Código: MIT; dependencias en site/licenses.

Las fechas de cruce son hipótesis de ritmo sostenido, sin validación hidrológica ni probabilidades de inundación. Los umbrales de catálogo no tienen vigencia histórica confirmada. El objetivo portuario de SNIH tiene equivalencia de escala sin confirmar.

No contiene originales de ingesta, credenciales, historial privado ni archivos importados por usuarios. Usa runners estándar públicos, Pages y artefacto con retención de un día; no habilita gastos adicionales. Aplican cuotas gratuitas de GitHub.

Configuración: Settings → Pages → GitHub Actions. Workflow: Publicar PULSO y actualizar observaciones.

Revisión de desarrollo: 26fa3aebf734a87b9acc03b7b9db046280b7c55b.
