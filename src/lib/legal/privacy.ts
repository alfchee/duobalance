export interface LegalDocument {
  title: string;
  version: string;
  effectiveDate: string;
  isAuthoritativeNotice: string;
  content: string;
}

export const PRIVACY_POLICY: Record<"es" | "en", LegalDocument> = {
  es: {
    title: "Política de Privacidad",
    version: "1.0",
    effectiveDate: "17 de agosto de 2026",
    isAuthoritativeNotice:
      "La versión oficial y legalmente vinculante de esta Política de Privacidad es la versión en español. Las traducciones a otros idiomas se proporcionan únicamente para conveniencia del usuario.",
    content: `# Política de Privacidad de DuoBalance

*Versión 1.0 — Fecha de entrada en vigor: 17 de agosto de 2026*

> **Nota sobre el idioma autoritativo:** La versión oficial y legalmente vinculante de esta Política de Privacidad es la versión en español. Las traducciones a otros idiomas (como el inglés) se proporcionan únicamente para conveniencia del usuario. En caso de cualquier discrepancia, la versión en español prevalecerá.

---

## 1. Identificación del Responsable del Tratamiento

El responsable del tratamiento de los datos personales recabados a través de **DuoBalance** es el equipo de desarrollo de DuoBalance ("nosotros" o "el Responsable").

- **Dirección de contacto legal:** Apartado Postal / Dirección de Notificaciones de Privacidad, Managua, Nicaragua.
- **Correo electrónico de contacto:** \`privacy@duobalanceapp.com\`

Marco normativo principal de referencia: **Ley N° 787 de Protección de Datos Personales de la República de Nicaragua**, junto con principios generales de protección de datos de las jurisdicciones de nuestro mercado objetivo en las Américas (incluyendo LFPDPPP de México y LGPD de Brasil).

---

## 2. Datos Personales que Recabamos

Recabamos únicamente la información necesaria para prestar el servicio de gestión de finanzas del hogar:

1. **Datos de Cuenta y Perfil:**
   - Correo electrónico.
   - Nombre de visualización (*display name*).
   - Credenciales de autenticación (contraseñas encriptadas y gestionadas de forma segura a través del servicio de autenticación).

2. **Datos Financieros y del Hogar (Ingresados voluntariamente por el usuario):**
   - Cuentas financieras (nombres de cuenta, tipo, moneda, saldos).
   - Transacciones (montos, fechas, categorías, notas y descripciones).
   - Presupuestos y recordatorios de facturas recurrentes.
   - Datos de vinculación con el hogar compartido y miembros asociados.

3. **Datos Técnicos y de Diagnóstico:**
   - Registros de acceso al servidor (*server logs*).
   - Dirección IP (utilizada exclusivamente con fines de seguridad, prevención de fraudes y enrutamiento técnico).
   - Tipo de navegador y agente de usuario (*User-Agent*).
   - Estado de sincronización local/remota.
   - Contexto de diagnóstico técnico al reportar problemas o enviar comentarios (versión de la aplicación, identificador de hogar y miembro, rol, configuración de idioma y formato de números, zona horaria, conteos de cuentas y transacciones, y detalles de errores técnicos, sin incluir montos, descripciones ni datos financieros).

---

## 3. Finalidad del Tratamiento y Base Legal

Procesamos sus datos personales con las siguientes finalidades y bases legales:

- **Prestación del Servicio (Ejecución del contrato):** Permitir la creación de cuentas, la sincronización de saldos y transacciones entre miembros de un mismo hogar, y la gestión de presupuestos.
- **Seguridad e Integridad (Interés legítimo):** Prevenir accesos no autorizados, proteger la infraestructura y diagnosticar errores técnicos.
- **Cumplimiento Legal y Consentimiento:** Registrar la aceptación explícita de esta política y atender solicitudes de ejercicios de derechos de protección de datos.

---

## 4. Almacenamiento y Región de la Base de Datos

Sus datos personales y financieros son almacenados en la infraestructura de base de datos de **Supabase Inc.** en la región AWS **us-east-1 (Norte de Virginia, Estados Unidos de América)**.

Toda la comunicación entre su dispositivo y los servidores se realiza a través de canales cifrados mediante HTTPS/TLS.

---

## 5. Subprocesadores de Datos (Terceros)

Para la operación de la plataforma, utilizamos únicamente los siguientes subprocesadores de servicios, seleccionados bajo estrictos estándares de seguridad y confidencialidad:

- **Supabase Inc.** (EE. UU. - Región AWS us-east-1): Proveedor de base de datos PostgreSQL, autenticación y almacenamiento de datos.
- **Vercel Inc.** (EE. UU.): Infraestructura de alojamiento del código de la aplicación web, red de distribución de contenidos (CDN) y ejecución de funciones de borde.
- **Resend Inc.** (EE. UU.): Proveedor para el envío de correos electrónicos transaccionales (confirmaciones de cuenta e invitaciones de miembros al hogar).
- **ExchangeRate-API** (EE. UU. / Global): Proveedor de datos de tipos de cambio de divisas para la conversión de monedas. *(Nota: No se transmiten datos personales a este servicio)*.

Mantendremos esta lista actualizada ante cualquier cambio en nuestros proveedores.

---

## 6. Retención de Datos y Eliminación

- **Periodo de retención:** Conservamos sus datos personales únicamente mientras su cuenta y/o su hogar permanezcan activos en DuoBalance.
- **Eliminación de datos:** Puede solicitar la eliminación completa de su cuenta u hogar en cualquier momento desde la sección de Configuración de la aplicación o enviando una solicitud a \`privacy@duobalanceapp.com\`. Al confirmar la eliminación, todos los datos asociados al hogar y a su perfil personal son eliminados permanentemente de nuestra base de datos activa.

---

## 7. Derechos del Usuario (Acceso, Rectificación, Exportación y Cancelación)

Usted tiene los siguientes derechos respecto a sus datos personales:

- **Derecho de Acceso y Rectificación:** Puede consultar y corregir su información personal y financiera en cualquier momento dentro de la aplicación.
- **Derecho de Exportación (Portabilidad):** DuoBalance incluye una herramienta nativa de **Exportación de Datos** (disponible en *Configuración → Sus Datos*) que le permite descargar en cualquier momento una copia completa de su información financiera en formato JSON y CSV.
- **Derecho de Cancelación / Eliminación:** Puede solicitar la supresión total de su cuenta e información personal.

Para ejercer sus derechos de forma manual o realizar cualquier consulta sobre privacidad, puede escribir a: \`privacy@duobalanceapp.com\`.

---

## 8. Ausencia de Publicidad de Terceros y Rastreadores

- **Sin publicidad de terceros:** DuoBalance no incluye anuncios publicitarios de redes de terceros ni comercializa, vende o alquila sus datos a anunciantes o corredores de datos (*data brokers*).
- **Sin rastreo conductual:** No utilizamos herramientas de analítica conductual o rastreo de terceros (tales como Google Analytics o Meta Pixel).
- **Galletas (Cookies) estrictamente necesarias:** Solo se utilizan galletas o almacenamiento local técnico indispensable para mantener activa la sesión de autenticación del usuario.

---

## 9. Contacto

Si tiene preguntas, comentarios o inquietudes referentes a esta Política de Privacidad o al tratamiento de sus datos, por favor contáctenos a través de:

- **Correo electrónico:** \`privacy@duobalanceapp.com\`
- **Atención:** Oficial de Protección de Datos / Equipo DuoBalance
`,
  },
  en: {
    title: "Privacy Policy",
    version: "1.0",
    effectiveDate: "August 17, 2026",
    isAuthoritativeNotice:
      "The authoritative and legally binding version of this Privacy Policy is the Spanish version. Translations into other languages are provided solely for convenience.",
    content: `# DuoBalance Privacy Policy

*Version 1.0 — Effective Date: August 17, 2026*

> **Language & Version Note:** The authoritative and legally binding version of this Privacy Policy is the Spanish version. Translations into other languages (such as English) are provided solely for convenience. In the event of any conflict or inconsistency, the Spanish version shall govern.

---

## 1. Data Controller Identification

The data controller responsible for personal data collected through **DuoBalance** is the DuoBalance development team ("we", "us", or "the Controller").

- **Legal Contact Address:** P.O. Box / Privacy Notice Representative, Managua, Nicaragua.
- **Contact Email:** \`privacy@duobalanceapp.com\`

Primary governing law of reference: **Law No. 787 on Personal Data Protection of the Republic of Nicaragua**, along with general data protection principles across our target jurisdictions in the Americas (including Mexico's LFPDPPP and Brazil's LGPD).

---

## 2. Personal Data We Collect

We collect only the information necessary to deliver our household finance management service:

1. **Account and Profile Data:**
   - Email address.
   - Display name.
   - Authentication credentials (hashed passwords securely managed via our authentication provider).

2. **Financial and Household Data (Voluntarily provided by the user):**
   - Financial accounts (account names, type, currency, balances).
   - Transactions (amounts, dates, categories, notes, and descriptions).
   - Budgets and recurring bill reminders.
   - Shared household membership and partner linkage data.

3. **Technical and Diagnostic Data:**
   - Server access logs.
   - IP address (used strictly for security, fraud prevention, and technical routing).
   - Browser type and User-Agent.
   - Local/remote synchronization state.
   - Technical diagnostic context when reporting problems or submitting feedback (app version, household and member identifiers, role, locale and number format settings, timezone, account and transaction counts, and technical error details, explicitly excluding amounts, descriptions, or financial content).

---

## 3. Purpose and Lawful Basis for Processing

We process your personal data under the following purposes and legal grounds:

- **Service Delivery (Contract Performance):** To enable account creation, synchronize balances and transactions between members of a household, and manage budgets.
- **Security and Integrity (Legitimate Interest):** To prevent unauthorized access, protect infrastructure, and diagnose technical issues.
- **Legal Compliance and Consent:** To record explicit acceptance of this policy and fulfill data protection rights requests.

---

## 4. Storage and Database Region

Your personal and financial data is stored in the database infrastructure of **Supabase Inc.** in the AWS region **us-east-1 (N. Virginia, United States of America)**.

All communication between your device and our servers uses HTTPS/TLS encrypted channels.

---

## 5. Data Subprocessors (Third Parties)

To operate the platform, we engage only the following subprocessors, vetted under strict security and confidentiality standards:

- **Supabase Inc.** (USA - AWS region us-east-1): PostgreSQL database, authentication, and data storage provider.
- **Vercel Inc.** (USA): Web application hosting infrastructure, content delivery network (CDN), and edge functions.
- **Resend Inc.** (USA): Transactional email delivery service (for account verification and household invitation emails).
- **ExchangeRate-API** (USA / Global): Foreign exchange rates data provider. *(Note: No personal user data is sent to this service)*.

We will keep this list updated whenever our service providers change.

---

## 6. Data Retention and Account Deletion

- **Retention Period:** We retain your personal data only as long as your account and/or household remain active in DuoBalance.
- **Account Deletion:** You may request complete deletion of your account or household at any time from the Settings section of the app or by contacting \`privacy@duobalanceapp.com\`. Upon deletion, all data associated with the household and your profile will be permanently removed from our active database.

---

## 7. User Rights (Access, Rectification, Export, and Deletion)

You have the following rights regarding your personal data:

- **Right of Access and Rectification:** You can view and update your personal and financial information at any time within the app.
- **Right to Export (Portability):** DuoBalance includes a built-in **Data Export** tool (available in *Settings → Your Data*) allowing you to download a complete copy of your financial data in JSON and CSV formats at any time.
- **Right to Deletion:** You may request the full erasure of your account and personal data.

To exercise your rights manually or submit any privacy inquiry, contact us at: \`privacy@duobalanceapp.com\`.

---

## 8. No Third-Party Ads or Tracking

- **No Third-Party Advertising:** DuoBalance does not display third-party advertisements and never sells, rents, or trades your data with third parties or data brokers.
- **No Behavioral Tracking:** We do not use third-party analytics or tracking tools (such as Google Analytics or Meta Pixel).
- **Strictly Necessary Cookies:** We only use technical cookies or local storage strictly required to maintain active user authentication sessions.

---

## 9. Contact Us

If you have questions, comments, or concerns regarding this Privacy Policy or data processing, please contact us at:

- **Email:** \`privacy@duobalanceapp.com\`
- **Attention:** Data Protection Representative / DuoBalance Team
`,
  },
};
