import { type LegalDocument } from "./privacy";

export const TERMS_OF_SERVICE: Record<"es" | "en", LegalDocument> = {
  es: {
    title: "Términos de Servicio",
    version: "1.0",
    effectiveDate: "17 de agosto de 2026",
    isAuthoritativeNotice:
      "La versión oficial y legalmente vinculante de estos Términos de Servicio es la versión en español. Las traducciones a otros idiomas se proporcionan únicamente para conveniencia del usuario.",
    content: `# Términos de Servicio de DuoBalance

*Versión 1.0 — Fecha de entrada en vigor: 17 de agosto de 2026*

> **Nota sobre el idioma autoritativo:** La versión oficial y legalmente vinculante de estos Términos de Servicio es la versión en español. Las traducciones a otros idiomas (como el inglés) se proporcionan únicamente para conveniencia del usuario. En caso de cualquier discrepancia, la versión en español prevalecerá.

---

## 1. Aceptación de los Términos

Al crear una cuenta, acceder o utilizar **DuoBalance** ("el Servicio"), usted acepta estar sujeto a los presentes Términos de Servicio y a nuestra [Política de Privacidad](/privacy). Si no está de acuerdo con alguna parte de estos términos, no debe utilizar el servicio.

---

## 2. Aviso de Software en Fase Beta y Ausencia de Garantías

1. **Aviso de Fase Beta:** DuoBalance se encuentra actualmente en fase de desarrollo y pruebas de versión **Beta**. El servicio se proporciona **"TAL CUAL" ("AS IS")** y **"SEGÚN DISPONIBILIDAD" ("AS AVAILABLE")**.
2. **Sin Garantías:** En la máxima medida permitida por la ley aplicable, el equipo de DuoBalance no otorga garantías explícitas ni implícitas sobre el funcionamiento ininterrumpido, libre de errores, o la idoneidad del servicio para un propósito contable o legal específico.
3. **Mantenimiento de Registros Propios:** **Se aconseja expresamente a los usuarios mantener sus propios registros contables y respaldos independientes de sus datos financieros.** DuoBalance no asume responsabilidad alguna por pérdidas accidental de datos o interrupciones temporales del servicio durante esta etapa de prueba.

---

## 3. Uso Aceptable del Servicio

Usted se compromete a utilizar DuoBalance exclusivamente con fines legítimos de administración financiera personal y del hogar. Queda estrictamente prohibido:

- Utilizar el servicio para actividades ilícitas, fraudulentas o no autorizadas.
- Intentar acceder sin autorización a datos de otros usuarios o hogares.
- Realizar ingeniería inversa, descompilar o intentar extraer el código fuente del sistema.
- Interferir con la integridad o el rendimiento del servicio o realizar ataques de denegación de servicio (DDoS).

---

## 4. Cuentas y Responsabilidad

- **Seguridad de la Cuenta:** Usted es responsable de mantener la confidencialidad de sus credenciales de acceso (correo y contraseña).
- **Notificación:** Debe notificarnos de inmediato si detecta cualquier uso no autorizado de su cuenta.
- **Cancelación:** Nos reservamos el derecho de suspender o cancelar cuentas que incumplan estos Términos de Servicio o que realicen un uso abusivo de la plataforma.

---

## 5. Tarifas y Facturación

Actualmente, el servicio DuoBalance se ofrece de forma gratuita durante su periodo Beta. Si en el futuro se introducen planes de suscripción o características de pago, se informará oportunamente a los usuarios y se requerirá una aceptación explícita antes de realizar cualquier cobro.

---

## 6. Modificaciones al Servicio y a los Términos

Nos reservamos el derecho de modificar, actualizar o discontinuar cualquier aspecto del servicio en cualquier momento. De igual manera, podremos actualizar estos Términos de Servicio periódicamente. Notificaremos los cambios significativos mediante la actualización de la fecha de entrada en vigor en esta página y, cuando corresponda, mediante un aviso dentro de la aplicación.

---

## 7. Ley Aplicable y Jurisdicción

Estos Términos de Servicio se rigen e interpretan de conformidad con las leyes de la **República de Nicaragua**. Cualquier controversia o reclamo derivado del uso del servicio se someterá a la jurisdicción exclusiva de los tribunales competentes de Nicaragua.

---

## 8. Contacto

Si tiene alguna duda o consulta sobre estos Términos de Servicio, puede comunicarse con nosotros en:

- **Correo electrónico:** \`privacy@duobalance.app\`
`,
  },
  en: {
    title: "Terms of Service",
    version: "1.0",
    effectiveDate: "August 17, 2026",
    isAuthoritativeNotice:
      "The authoritative and legally binding version of these Terms of Service is the Spanish version. Translations into other languages are provided solely for convenience.",
    content: `# DuoBalance Terms of Service

*Version 1.0 — Effective Date: August 17, 2026*

> **Language & Version Note:** The authoritative and legally binding version of these Terms of Service is the Spanish version. Translations into other languages (such as English) are provided solely for convenience. In the event of any conflict or inconsistency, the Spanish version shall govern.

---

## 1. Acceptance of Terms

By creating an account, accessing, or using **DuoBalance** ("the Service"), you agree to be bound by these Terms of Service and our [Privacy Policy](/privacy). If you do not agree to any part of these terms, you must not use the service.

---

## 2. Beta Software Notice and Disclaimer of Warranties

1. **Beta Notice:** DuoBalance is currently offered in a **Beta** testing and development phase. The service is provided **"AS IS"** and **"AS AVAILABLE"**.
2. **No Warranties:** To the maximum extent permitted by applicable law, the DuoBalance team makes no express or implied warranties regarding uninterrupted operation, error-free performance, or fitness of the service for any specific legal or accounting purpose.
3. **Maintain Your Own Records:** **Users are explicitly advised to maintain their own independent financial backup records.** DuoBalance accepts no liability for accidental data loss or temporary service interruptions during this beta testing phase.

---

## 3. Acceptable Use

You agree to use DuoBalance strictly for lawful personal and household financial management purposes. The following activities are strictly prohibited:

- Using the service for illegal, fraudulent, or unauthorized activities.
- Attempting to access data belonging to other users or households without authorization.
- Reverse engineering, decompiling, or attempting to extract the system source code.
- Interfering with the performance or integrity of the service or conducting denial-of-service (DDoS) attacks.

---

## 4. Accounts and Security

- **Account Security:** You are responsible for maintaining the confidentiality of your account credentials (email and password).
- **Notification:** You must notify us immediately if you suspect any unauthorized access to your account.
- **Termination:** We reserve the right to suspend or terminate accounts that violate these Terms of Service or abuse the platform.

---

## 5. Fees and Billing

DuoBalance is currently offered free of charge during its Beta phase. If paid subscription plans or features are introduced in the future, users will be notified in advance and explicit consent will be required prior to any charge.

---

## 6. Service and Terms Modifications

We reserve the right to modify, update, or discontinue any aspect of the service at any time. We may also update these Terms of Service periodically. Significant changes will be notified by updating the effective date on this page and, where appropriate, through an in-app notice.

---

## 7. Governing Law and Jurisdiction

These Terms of Service are governed by and construed in accordance with the laws of the **Republic of Nicaragua**. Any dispute or claim arising from the use of the service shall be subject to the exclusive jurisdiction of the competent courts of Nicaragua.

---

## 8. Contact Us

For any questions or inquiries regarding these Terms of Service, please contact us at:

- **Email:** \`privacy@duobalance.app\`
`,
  },
};
