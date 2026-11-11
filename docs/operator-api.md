# Contrato HTTP del operador

El backend operador llama a la API por HTTPS fuera del entorno local. Cada instancia admite un `API_SERVICE_TOKEN` asociado al `API_SERVICE_BUSINESS_ID`. Envía `Authorization: Bearer <token>` y `Content-Type: application/json` para cuerpos JSON. Reserva `API_ADMIN_TOKEN` para la administración, incluida la conexión de Google.

## Procesar un mensaje entrante

1. Envía `POST /customers/upsert/whatsapp` con `businessId`, `whatsappPhone` (10 a 15 dígitos) y, si está disponible, `whatsappName`. Conserva el `id` del cliente.
2. Envía `POST /conversations/active` con `businessId` y `customerId`. Conserva el `id` de la conversación.
3. Envía `POST /messages/inbound` con `businessId`, `customerId`, `conversationId`, el ID original de WhatsApp en `whatsappMessageId`, `messageType` y `content` cuando aplique. Conserva el `id` de la respuesta. Repetir el mismo `whatsappMessageId` en el mismo contexto devuelve el mensaje existente. Si el mensaje ya está asociado a otro contexto, la API devuelve `409`.
4. Envía `POST /flow-engine/process` con `businessId`, `customerId`, `conversationId`, `messageId`, `messageType` y `text` o `interactiveId` según el tipo. Usa el mismo `messageId` al reintentar. El resultado incluye `responses` y, para una reserva confirmada, `metadata.appointmentId`. El operador debe deduplicar el envío a WhatsApp por mensaje de origen y posición de la respuesta porque la API puede devolver el resultado guardado.
5. Para registrar la salida, usa `POST /messages/outbound` con el mismo contexto. Después del envío al proveedor, registra su identificador con `PATCH /messages/{id}/sent`. Envía las actualizaciones del proveedor a `POST /messages/delivery-status` con el ID original de WhatsApp y el estado recibido.

| Respuesta | Acción del operador |
| --- | --- |
| `401` | Verifica la credencial y vuelve a autenticar. |
| `403` o `404` de un recurso | Verifica el negocio, el permiso y los identificadores del recurso. |
| `400` | Corrige el cuerpo o el contexto antes de reenviar. |
| `409 FLOW_CONVERSATION_BUSY` | Reintenta con espera breve y el mismo `messageId`. |
| `409 FLOW_MESSAGE_OUTCOME_UNKNOWN` | Consulta el mensaje y la conversación. El intento puede haber aplicado cambios antes de perder su respuesta. Escala a un operador para resolverlo. |
| Error transitorio de red o `5xx` | Reintenta la solicitud de flujo con el mismo `messageId` y espera creciente. Si recibe un resultado guardado, usa la misma deduplicación para la salida. |

Para consultar una cita usa `GET /businesses/{businessId}/appointments/{appointmentId}`. Usa `PATCH` con el sufijo `/reschedule` (campos `date` en `YYYY-MM-DD` y `time` en `HH:mm`, hora del negocio) o `/cancel` (motivo opcional). La cita se actualiza primero y el worker sincroniza Calendar después.

## Reconectar Google Calendar

Con la credencial administrativa, genera la URL con `GET /businesses/{businessId}/integrations/google/auth-url`. Puedes indicar `calendarId` como parámetro si vas a elegir otro calendario. En Google concede acceso a los eventos y a los datos del calendario que identifican el destino.

Si la cuenta y el calendario coinciden con los anteriores, el callback reactiva la conexión y encola la reconciliación. Si difieren o la conexión previa es anterior al registro de identidad del calendario, la sincronización se pausa. Consulta el destino actual y el pendiente con `GET /businesses/{businessId}/integrations/google/connection`. Verifica el destino y confírmalo con `PATCH /businesses/{businessId}/integrations/google/connection/{confirmationId}`.

Para una conexión anterior sin identidad verificada, añade `?preserveLegacyLinks=true` solo si verificaste que es el calendario anterior. Para adoptar otro destino, usa `?preserveLegacyLinks=false`. Cuando cambia el destino, se recrean las citas vigentes en el nuevo calendario. Revisa en el calendario anterior los eventos que deban retirarse de allí.
