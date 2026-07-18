"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";

const ARTICLE_CLASSNAME =
  "mt-8 text-mist [&_a]:text-lime-text [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-fg [&_h1]:mb-2 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-fg [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-fg [&_h4]:mt-4 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-fg [&_li]:leading-relaxed [&_p]:mt-4 [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-fg [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6";

export default function TerminosPage() {
  const { t } = useI18n();
  return (
    <main className="bg-ink px-5 py-20 text-fg sm:px-8">
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
          <h1>{t("Términos y Condiciones de Servicio — Du Labs", "Terms and Conditions of Service — Du Labs")}</h1>
          <p>{t("Última actualización: 13 de julio de 2026", "Last updated: July 13, 2026")}</p>
          <p>
            {t("Bienvenido a Du Labs (accesible a través de", "Welcome to Du Labs (accessible via")}{" "}
            <a href="https://dulabs.co">https://dulabs.co</a>
            {t(
              "). Al registrarte, conectar tu cuenta y utilizar nuestra plataforma de automatización conversacional basada en inteligencia artificial, aceptas cumplir y quedar sujeto a los siguientes Términos y Condiciones de Servicio. Si no estás de acuerdo con alguna de estas cláusulas, deberás abstenerte de utilizar nuestro sistema.",
              "). By registering, connecting your account, and using our AI-based conversational automation platform, you agree to comply with and be bound by the following Terms and Conditions of Service. If you do not agree with any of these clauses, you must refrain from using our system."
            )}
          </p>

          <h2>{t("1. Naturaleza del servicio", "1. Nature of the service")}</h2>
          <p>
            {t(
              "Du Labs es un software como servicio (SaaS) que permite a los usuarios integrar la API oficial de WhatsApp (Meta) con modelos de lenguaje de inteligencia artificial para automatizar la atención al cliente de sus negocios. Du Labs actúa única y exclusivamente como un intermediario técnico y proveedor de la infraestructura de procesamiento de datos.",
              "Du Labs is a software-as-a-service (SaaS) platform that lets users integrate the official WhatsApp API (Meta) with AI language models to automate customer service for their businesses. Du Labs acts solely and exclusively as a technical intermediary and provider of the data-processing infrastructure."
            )}
          </p>

          <h2>{t("2. Uso de la API de Meta y modo coexistencia", "2. Use of the Meta API and coexistence mode")}</h2>
          <p>
            {t(
              "Al iniciar sesión con el Facebook de tu empresa y vincular tu número de WhatsApp Business, entiendes y aceptas que:",
              "By logging in with your company's Facebook and linking your WhatsApp Business number, you understand and agree that:"
            )}
          </p>
          <ul>
            <li>
              {t(
                "Autorizas expresamente a Du Labs a enviar y recibir mensajes de WhatsApp en nombre de tu negocio mediante la API oficial de Meta.",
                "You expressly authorize Du Labs to send and receive WhatsApp messages on behalf of your business via Meta's official API."
              )}
            </li>
            <li>
              {t(
                "El servicio opera en \"modo coexistencia\", lo que significa que seguirás usando tu aplicación móvil con normalidad mientras la IA atiende en paralelo, permitiéndote intervenir en los chats cuando lo desees.",
                "The service operates in \"coexistence mode\", meaning you'll keep using your mobile app normally while the AI handles chats in parallel, letting you step in whenever you want."
              )}
            </li>
            <li>
              {t(
                "El usuario es el único responsable de cumplir estrictamente con las Políticas comerciales y de privacidad de WhatsApp Business establecidas por Meta.",
                "The user is solely responsible for strictly complying with the WhatsApp Business commerce and privacy policies established by Meta."
              )}
            </li>
            <li>
              {t(
                "Du Labs no se hace responsable por suspensiones, bloqueos o baneos de números telefónicos por parte de Meta debido a sospechas de spam o violaciones a sus políticas de uso.",
                "Du Labs is not responsible for suspensions, blocks, or bans of phone numbers by Meta due to suspected spam or violations of its usage policies."
              )}
            </li>
          </ul>

          <h2>{t("3. Limitación de responsabilidad de la inteligencia artificial", "3. Limitation of liability for the artificial intelligence")}</h2>
          <ul>
            <li>
              <strong>{t("Supervisión del usuario:", "User oversight:")}</strong>{" "}
              {t(
                "El usuario acepta que las respuestas son generadas de forma automatizada por modelos de Inteligencia Artificial. Du Labs no garantiza que las respuestas del bot sean 100% precisas, correctas o libres de errores en todo momento. Es responsabilidad del usuario supervisar el sistema e intervenir cuando sea necesario.",
                "The user accepts that responses are generated automatically by Artificial Intelligence models. Du Labs does not guarantee that the bot's responses will be 100% accurate, correct, or error-free at all times. It is the user's responsibility to supervise the system and step in when necessary."
              )}
            </li>
            <li>
              <strong>{t("Daños indirectos:", "Indirect damages:")}</strong>{" "}
              {t(
                "En ningún caso Du Labs será responsable por pérdidas de ventas, malentendidos con clientes finales, o daños reputacionales derivados de una respuesta inadecuada generada por la IA.",
                "Under no circumstances will Du Labs be liable for lost sales, misunderstandings with end customers, or reputational damage arising from an inadequate response generated by the AI."
              )}
            </li>
          </ul>

          <h2>{t("4. Disponibilidad y pagos", "4. Availability and payments")}</h2>
          <ul>
            <li>
              {t(
                "Du Labs se esfuerza por mantener la plataforma disponible de forma continua, pero no se hace responsable por interrupciones del servicio causadas por caídas globales en los servidores de Meta (WhatsApp) o de nuestros proveedores de infraestructura en la nube.",
                "Du Labs strives to keep the platform continuously available, but is not responsible for service interruptions caused by global outages on Meta's (WhatsApp) servers or our cloud infrastructure providers."
              )}
            </li>
            <li>
              {t(
                "Nos reservamos el derecho de modificar los planes, límites de mensajes y precios del servicio notificándolo previamente a los usuarios.",
                "We reserve the right to modify plans, message limits, and service pricing, notifying users in advance."
              )}
            </li>
          </ul>

          <h2>{t("5. Contacto", "5. Contact")}</h2>
          <p>
            {t("Para cualquier duda, aclaración o soporte legal relacionado con estos términos, puedes escribirnos directamente a:", "For any questions, clarifications, or legal support related to these terms, you can write to us directly at:")}{" "}
            <a href="mailto:vandusfor@gmail.com">vandusfor@gmail.com</a>.
          </p>
        </article>
      </div>
    </main>
  );
}
