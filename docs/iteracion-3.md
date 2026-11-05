# LIA · Iteración 3: lo imprescindible antes de las pruebas con usuarios

4 de noviembre de 2026. A partir de la revisión de Coconut (`revision.txt`, registrada en Notion). Las pruebas con usuarios son el **viernes 6 de noviembre**: entra todo lo marcado MH; lo NtH, solo si sobra tiempo. Decisiones de Coconut del 4-nov: reorganizar la interfaz que hay (sin rediseño visual), recordatorios por WhatsApp y Google Calendar (se quitan los avisos del navegador), audios de WhatsApp transcritos solo en Pro.

## Problema

Quien prueba LIA hoy se topa con fallas que esconden el valor del producto:
- Los recordatorios no llegan.
- Google Calendar no trae los cambios hechos después de conectarlo.
- Lía entiende al revés tres pedidos comunes y no responde a los audios.
- Dos actividades a la misma hora se pisan en pantalla.
- Se pueden guardar duplicados o cruces sin aviso.

Con esas fallas, la prueba del viernes mediría los errores y no la idea.

## Objetivos

1. Una persona de prueba recibe el recordatorio de su próxima actividad por WhatsApp (dentro de las 24 horas, o con la plantilla de Meta) y por la alerta de Google Calendar.
2. Un cambio en Google Calendar aparece en LIA en menos de un minuto con la app abierta, o al abrirla.
3. Las tres frases de la revisión y un test nuevo, más difícil (crear, buscar, eliminar y modificar), salen bien con las reglas solas o pasan a la IA. Ninguna se entiende al revés.
4. Dos actividades a la misma hora se ven lado a lado, y LIA avisa antes de guardar un duplicado o un cruce.

## No-objetivos

- Rediseño visual (colores, tipografía, marca): se reorganiza lo que hay.
- Modalidad, salón o enlace (NtH), varias operaciones en un mensaje (NtH), resumen diario (NtH) y personalizar el contacto de WhatsApp (NtH): después de las pruebas.
- Número propio de WhatsApp: sigue el número de prueba de Meta (5 destinatarios).
- Cobro con Mercado Pago: pospuesto (`docs/pagos.md`).

## Requisitos (P0) y criterios de aceptación

### 1. Google Calendar trae los cambios (servidor, `lia-google`)

Causa: Google manda el primer aviso del canal (`sync`) antes de que LIA guarde el canal. `lia-google` respondía 404 y Google no volvió a avisar (registro del 3-nov, 22:49).
- [ ] Un aviso `sync` responde 200 aunque el canal aún no esté guardado. Un aviso de un canal desconocido responde 200 sin hacer nada.
- [ ] Los canales que ya existen se vuelven a crear en la próxima renovación (una migración pone `canal_vence = now()`).
- [ ] Prueba: el aviso `sync` antes de guardar el canal da 200, y un aviso posterior suma la señal.

### 2. Recordatorios por WhatsApp y Google Calendar

- [ ] WhatsApp avisa de **toda** la agenda publicada:
  - Estudio y eventos o rutinas, 15 minutos antes.
  - Evaluaciones, 2 horas antes.
  - Hoy solo avisa de estudio y evaluaciones (`tomar_avisos_whatsapp`).
  - «pausa» sigue apagándolos.
- [ ] Los eventos del calendario «LIA» llevan alerta de Google (aviso emergente): 15 minutos antes, o 2 horas en evaluaciones. Los que ya estaban se actualizan para tener la alerta.
- [ ] Fuera de las 24 horas desde el último mensaje de la persona, WhatsApp solo entrega con una plantilla Utility aprobada (`WHATSAPP_PLANTILLA`). La configura Coconut (`docs/canales.md`, paso 5).
- [ ] Se quitan de la app la tarjeta y los botones de «activar recordatorios» del navegador. Ya no se llama a `programar_avisos` ni se pide permiso de notificaciones; `lia-avisos` queda sin uso.

### 3. Audios de WhatsApp (solo Pro)

- [ ] Un audio de una cuenta Pro con cupo se descarga de Meta y se transcribe con Whisper en Groq (`whisper-large-v3-turbo`, español). El texto sigue el mismo camino que un mensaje escrito. Descuenta 1 del cupo de la IA.
- [ ] Ni el audio ni la transcripción se guardan ni se escriben en los registros.
- [ ] En Gratis: «Los audios son de LIA Pro. Escríbeme lo mismo y lo entiendo». Si dura más de 2 minutos o pesa más de 5 MB: «Ese audio es muy largo: mándame uno de menos de 2 minutos o escríbelo».
- [ ] El aviso de privacidad de Lía en WhatsApp dice que los audios los transcribe Groq y no se guardan.

### 4. Lía entiende mejor (reglas en `interpret()`; test nuevo)

- [ ] «Elimina el evento del lunes a la 1:00 pm»: propone quitar lo que hay el lunes a esa hora; nunca crea uno nuevo.
  - Si es una rutina, pregunta si quita solo ese lunes o la rutina.
  - Si no hay nada a esa hora, lo dice.
- [ ] «Crea un evento semanal de almuerzo, de lunes a viernes de 1:00 pm a 2:30 pm»: una rutina «Almuerzo» de lunes a viernes, de 13:00 a 14:30.
- [ ] «Tengo una entrega de un avance del proyecto de emprendimiento este viernes a las 5»: una evaluación de tipo entrega del curso de emprendimiento, este viernes a las 17:00. Nunca una búsqueda.
- [ ] Test nuevo de al menos 30 frases más difíciles en `pruebas/ia/frases.json`: crear, buscar, eliminar y modificar, con fechas relativas, rangos de días y cursos existentes. Con las reglas solas, ninguna se entiende al revés. Las que no entienden pasan a la IA (`pideIA`).
- [ ] Una evaluación nueva se liga al curso existente que tenga el nombre más parecido («cálculo» → «Cálculo I»).
- [ ] Coconut corre la evaluación con el modelo real (`pruebas/ia/evaluar.mjs`).

### 5. Horario

- [ ] **Cruces:** en Semana y en Tu día, dos o más actividades a la misma hora se ven en columnas lado a lado, cada una con su nombre legible. Desde 3 a la vez, «+N» con la lista al tocar.
- [ ] **Duplicados y cruces antes de guardar:** al guardar una rutina, un evento de un día o una evaluación:
  - Si ya hay una igual (mismo nombre, día y horas): «Ya tienes «Almuerzo» el lunes de 13:00 a 14:30».
  - Si se cruza con otra: «Se cruza con «Trabajo» (lunes, 9:00–18:00)».
  - Las dos opciones son «Guardar igual» y «Volver».
  - Lo mismo en las propuestas del chat y de WhatsApp («¿Lo guardo igual?»).
- [ ] **Consolidado después del registro:** «Importar consolidado» está en el menú «+» y en Perfil, no solo en el primer paso.
- [ ] **Evaluación ligada a un curso:** al crear una evaluación, los cursos (clases) que ya existen aparecen para elegir; también se puede escribir uno nuevo. La evaluación queda con el nombre exacto del curso y se ve con el color de su clase.

### 6. Interfaz reorganizada

- [ ] **Hoy** es una agenda del día: lo que sigue arriba, con horas, cruces y el próximo estudio.
- [ ] **Semana** es una cuadrícula de horas por día, con cruces lado a lado.
- [ ] Un solo botón **«+»** para agregar: rutina, evento de un día, evaluación o importar consolidado.
- [ ] Inspirado en Google Calendar y MyStudyLife. Mismo estilo visual y accesibilidad AA.
- [ ] Se quita la **función de instalación**: el botón y el aviso de instalar. Quien ya la instaló la sigue usando.

## Métricas

En la prueba del viernes:
- Recordatorios que llegan en hora: meta ≥ 90 %.
- Frases de la prueba que Lía entiende a la primera: meta ≥ 85 %.
- Personas que agregan una actividad sin ayuda: meta ≥ 4 de 5.

## Preguntas abiertas

- **Coconut:** la plantilla Utility de recordatorios en Meta, para avisar fuera de las 24 horas. Tarda en aprobarse; sin ella, solo llegan los avisos de quien escribió a LIA ese día.
- **Coconut:** permiso para desplegar `lia-google` y `lia-whatsapp`, aplicar las migraciones y publicar en `main`.

## Fases

1. Miércoles 4 y jueves 5: servidor (Google, recordatorios, audios), Lía y horario, en ramas cortas.
2. Jueves 5 por la noche: revisión, PR y publicación con permiso.
3. Viernes 6: pruebas con usuarios.
