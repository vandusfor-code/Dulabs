"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";

const ARTICLE_CLASSNAME =
  "mt-8 text-mist [&_a]:text-lime-text [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-fg [&_h1]:mb-2 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-fg [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-fg [&_h4]:mt-4 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-fg [&_li]:leading-relaxed [&_p]:mt-4 [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-fg [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6";

export default function EliminacionDatosPage() {
  const { t } = useI18n();
  return (
    <main className="dash-scope bg-ink px-5 py-20 text-fg sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-lime-text transition-colors duration-200 hover:text-fg"
          >
            {t("← Volver a Du Labs", "← Back to Du Labs")}
          </Link>
          <LanguageSelector tone="dark" />
        </div>
        <article className={ARTICLE_CLASSNAME}>
          <h1>{t("Política de Eliminación de Datos de WhatsApp — Du Labs", "WhatsApp Data Deletion Policy — Du Labs")}</h1>
          <p>{t("Última actualización: abril de 2026", "Last updated: April 2026")}</p>
          <p>
            {t(
              "En Du Labs, operado por RAMOS PADILLA DUVAN ANDRES, respetamos tu privacidad y los datos de tus clientes. Esta política explica cómo puedes solicitar la eliminación de los datos asociados a tu cuenta de WhatsApp Business conectada a través de nuestra plataforma.",
              "At Du Labs, operated by RAMOS PADILLA DUVAN ANDRES, we respect your privacy and your customers' data. This policy explains how you can request the deletion of data associated with your WhatsApp Business account connected through our platform."
            )}
          </p>

          <h2>{t("1. ¿Qué datos recopilamos de WhatsApp?", "1. What WhatsApp data do we collect?")}</h2>
          <p>
            {t("Cuando conectas tu número de WhatsApp Business a Du Labs, podemos procesar:", "When you connect your WhatsApp Business number to Du Labs, we may process:")}
          </p>
          <ul>
            <li>
              <strong>{t("Datos del negocio:", "Business data:")}</strong> {t("nombre, correo y número de teléfono conectado.", "name, email, and connected phone number.")}
            </li>
            <li>
              <strong>{t("Datos de conversación:", "Conversation data:")}</strong> {t("mensajes enviados y recibidos, nombre del cliente final, fecha y hora.", "messages sent and received, end-customer name, date and time.")}
            </li>
            <li>
              <strong>{t("Datos técnicos:", "Technical data:")}</strong> {t("ID de WhatsApp, logs de webhooks y estado de mensajes.", "WhatsApp ID, webhook logs, and message status.")}
            </li>
          </ul>
          <p>
            {t(
              "Usamos estos datos únicamente para: prestar el servicio de chatbot, generar reportes y cumplir con obligaciones legales.",
              "We use this data solely to: provide the chatbot service, generate reports, and comply with legal obligations."
            )}
          </p>

          <h2>{t("2. ¿Cómo solicitar la eliminación de datos?", "2. How to request data deletion?")}</h2>
          <p>{t("Tienes dos opciones:", "You have two options:")}</p>

          <h3>{t("Opción A: Desde tu panel de Du Labs", "Option A: From your Du Labs dashboard")}</h3>
          <ul>
            <li>
              {t("Inicia sesión en", "Sign in at")}{" "}
              <a href="https://dulabs.co">dulabs.co</a>
            </li>
            <li>{t("Ve a Números y busca la línea que quieres desconectar", "Go to Numbers and find the line you want to disconnect")}</li>
            <li>
              {t(
                "Haz clic en \"Eliminar mis datos\" y confirma. El número se desconecta de Meta y sus datos se borran de inmediato.",
                "Click \"Delete my data\" and confirm. The number is disconnected from Meta and its data is deleted immediately."
              )}
            </li>
          </ul>

          <h3>{t("Opción B: Solicitud por correo", "Option B: Request by email")}</h3>
          <p>
            {t("Envía un correo a:", "Send an email to:")}{" "}
            <a href="mailto:contacto@dulabs.co">contacto@dulabs.co</a>
          </p>
          <p>{t("Asunto: SOLICITUD ELIMINACIÓN DATOS WHATSAPP", "Subject: WHATSAPP DATA DELETION REQUEST")}</p>
          <p>
            {t(
              "Incluye: nombre del negocio, número de WhatsApp conectado y correo de la cuenta Du Labs.",
              "Include: business name, connected WhatsApp number, and Du Labs account email."
            )}
          </p>
          <p>
            {t(
              "Responderemos y confirmaremos la eliminación en un máximo de 5 días hábiles.",
              "We will respond and confirm the deletion within a maximum of 5 business days."
            )}
          </p>

          <h2>{t("3. ¿Qué se elimina?", "3. What gets deleted?")}</h2>
          <p>{t("Al solicitar la eliminación:", "When you request deletion:")}</p>
          <ul>
            <li>
              {t("Desconectamos tu número de la WhatsApp Business API de Meta.", "We disconnect your number from Meta's WhatsApp Business API.")}
            </li>
            <li>
              {t(
                "Borramos todos los mensajes, logs y datos de clientes asociados a tu cuenta en nuestros servidores.",
                "We delete all messages, logs, and customer data associated with your account on our servers."
              )}
            </li>
            <li>{t("Revocamos los permisos de acceso a tu WhatsApp Business.", "We revoke access permissions to your WhatsApp Business.")}</li>
          </ul>
          <p>
            <strong>{t("Nota:", "Note:")}</strong>{" "}
            {t(
              "algunos datos pueden conservarse por 30 días adicionales por temas de seguridad y respaldo, y luego se eliminan permanentemente. No vendemos ni compartimos tus datos con terceros.",
              "some data may be retained for an additional 30 days for security and backup purposes, then permanently deleted. We do not sell or share your data with third parties."
            )}
          </p>

          <h2>{t("4. Datos de tus clientes finales", "4. Your end-customers' data")}</h2>
          <p>
            {t(
              "Como negocio, tú eres el responsable de los datos de tus clientes. Al usar Du Labs te comprometes a tener el consentimiento de tus clientes para contactarlos por WhatsApp. Si un cliente final te pide borrar sus datos, escríbenos a",
              "As a business, you are responsible for your customers' data. By using Du Labs you commit to having your customers' consent to contact them via WhatsApp. If an end customer asks you to delete their data, write to us at"
            )}{" "}
            <a href="mailto:contacto@dulabs.co">contacto@dulabs.co</a>{" "}
            {t(
              "con el número del cliente y su solicitud, y eliminamos su conversación de nuestros servidores.",
              "with the customer's number and their request, and we will delete their conversation from our servers."
            )}
          </p>

          <h2>{t("5. Contacto", "5. Contact")}</h2>
          <p>{t("Para cualquier duda sobre esta política:", "For any questions about this policy:")}</p>
          <ul>
            <li>Du Labs</li>
            <li>
              {t("Correo:", "Email:")} <a href="mailto:contacto@dulabs.co">contacto@dulabs.co</a>
            </li>
            <li>
              {t("Web:", "Website:")} <a href="https://dulabs.co">dulabs.co</a>
            </li>
          </ul>
        </article>
      </div>
    </main>
  );
}
