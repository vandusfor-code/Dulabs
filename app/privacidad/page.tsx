"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";

const ARTICLE_CLASSNAME =
  "mt-8 text-mist [&_a]:text-lime-text [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-fg [&_h1]:mb-2 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-fg [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-fg [&_h4]:mt-4 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-fg [&_li]:leading-relaxed [&_p]:mt-4 [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-fg [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6";

export default function PrivacidadPage() {
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
          <h1>{t("Política de Privacidad", "Privacy Policy")}</h1>
          <p>{t("Última actualización: 13 de julio de 2026", "Last updated: July 13, 2026")}</p>
          <p>
            {t(
              "Esta Política de Privacidad describe nuestras políticas y procedimientos sobre la recopilación, el uso y la divulgación de tu información cuando utilizas el Servicio, y te informa sobre tus derechos de privacidad y cómo la ley te protege.",
              "This Privacy Policy describes our policies and procedures on the collection, use, and disclosure of your information when you use the Service, and tells you about your privacy rights and how the law protects you."
            )}
          </p>
          <p>
            {t(
              "Usamos tus Datos Personales para prestar y mejorar el Servicio. Al usar el Servicio, aceptas la recopilación y el uso de información de acuerdo con esta Política de Privacidad.",
              "We use your Personal Data to provide and improve the Service. By using the Service, you agree to the collection and use of information in accordance with this Privacy Policy."
            )}
          </p>

          <h2>{t("Interpretación y Definiciones", "Interpretation and Definitions")}</h2>
          <h3>{t("Interpretación", "Interpretation")}</h3>
          <p>
            {t(
              "Las palabras cuya letra inicial está en mayúscula tienen significados definidos bajo las siguientes condiciones. Las siguientes definiciones tendrán el mismo significado ya sea que aparezcan en singular o en plural.",
              "Words with an initial capital letter have meanings defined under the following conditions. The following definitions shall have the same meaning regardless of whether they appear in singular or in plural."
            )}
          </p>
          <h3>{t("Definiciones", "Definitions")}</h3>
          <p>{t("Para los propósitos de esta Política de Privacidad:", "For the purposes of this Privacy Policy:")}</p>
          <ul>
            <li>
              <p><strong>{t("Cuenta", "Account")}</strong> {t("significa una cuenta única creada para que accedas a nuestro Servicio o a partes de él.", "means a unique account created for you to access our Service or parts of it.")}</p>
            </li>
            <li>
              <p><strong>{t("Afiliada", "Affiliate")}</strong> {t("significa una entidad que controla, es controlada por, o está bajo control común con una parte, donde \"control\" significa la propiedad del 50% o más de las acciones, participación accionaria u otros valores con derecho a voto para la elección de directores u otra autoridad administrativa.", "means an entity that controls, is controlled by, or is under common control with a party, where \"control\" means ownership of 50% or more of the shares, equity interest, or other securities entitled to vote for election of directors or other managing authority.")}</p>
            </li>
            <li>
              <p><strong>{t("Aplicación", "Application")}</strong> {t("se refiere a Du Labs, el programa de software proporcionado por la Compañía.", "refers to Du Labs, the software program provided by the Company.")}</p>
            </li>
            <li>
              <p><strong>{t("Compañía", "Company")}</strong> {t("(referida como \"la Compañía\", \"Nosotros\", \"Nos\" o \"Nuestro\" en esta Política de Privacidad) se refiere a Du Labs, Montería, Córdoba, Colombia.", "(referred to as \"the Company\", \"We\", \"Us\", or \"Our\" in this Privacy Policy) refers to Du Labs, Montería, Córdoba, Colombia.")}</p>
            </li>
            <li>
              <p><strong>{t("Cookies", "Cookies")}</strong> {t("son pequeños archivos que un sitio web coloca en tu computadora, dispositivo móvil o cualquier otro dispositivo, y que contienen detalles de tu historial de navegación en ese sitio, entre muchos otros usos.", "are small files placed on your computer, mobile device, or any other device by a website, containing details of your browsing history on that site among its many uses.")}</p>
            </li>
            <li>
              <p><strong>{t("País", "Country")}</strong> {t("se refiere a: Colombia", "refers to: Colombia")}</p>
            </li>
            <li>
              <p><strong>{t("Dispositivo", "Device")}</strong> {t("significa cualquier dispositivo que pueda acceder al Servicio, como una computadora, un teléfono celular o una tableta digital.", "means any device that can access the Service, such as a computer, a cell phone, or a digital tablet.")}</p>
            </li>
            <li>
              <p><strong>{t("Datos Personales", "Personal Data")}</strong> {t("(o \"Información Personal\") es cualquier información relacionada con una persona identificada o identificable.", "(or \"Personal Information\") is any information relating to an identified or identifiable individual.")}</p>
              <p>{t("Usamos \"Datos Personales\" e \"Información Personal\" indistintamente, salvo que una ley utilice un término específico.", "We use \"Personal Data\" and \"Personal Information\" interchangeably, unless a law uses a specific term.")}</p>
            </li>
            <li>
              <p><strong>{t("Servicio", "Service")}</strong> {t("se refiere a la Aplicación, al Sitio Web, o a ambos.", "refers to the Application, the Website, or both.")}</p>
            </li>
            <li>
              <p><strong>{t("Proveedor de Servicios", "Service Provider")}</strong> {t("significa cualquier persona natural o jurídica que procese los datos en nombre de la Compañía. Se refiere a empresas o personas externas contratadas por la Compañía para facilitar el Servicio, prestar el Servicio en nombre de la Compañía, realizar servicios relacionados con el Servicio o ayudar a la Compañía a analizar cómo se usa el Servicio.", "means any natural or legal person who processes the data on behalf of the Company. It refers to third-party companies or individuals employed by the Company to facilitate the Service, to provide the Service on behalf of the Company, to perform services related to the Service, or to assist the Company in analyzing how the Service is used.")}</p>
            </li>
            <li>
              <p><strong>{t("Datos de Uso", "Usage Data")}</strong> {t("se refiere a datos recopilados automáticamente, ya sea generados por el uso del Servicio o por la propia infraestructura del Servicio (por ejemplo, la duración de una visita a una página).", "refers to data collected automatically, either generated by the use of the Service or from the Service infrastructure itself (for example, the duration of a page visit).")}</p>
            </li>
            <li>
              <p><strong>{t("Sitio Web", "Website")}</strong> {t("se refiere a Du Labs, accesible desde", "refers to Du Labs, accessible from")} <a href="https://dulabs.co" rel="external nofollow noopener" target="_blank">https://dulabs.co</a>.</p>
            </li>
            <li>
              <p><strong>{t("Tú", "You")}</strong> {t("significa la persona que accede o utiliza el Servicio, o la empresa u otra entidad legal en cuyo nombre dicha persona accede o utiliza el Servicio, según corresponda.", "means the individual accessing or using the Service, or the company or other legal entity on behalf of which such individual is accessing or using the Service, as applicable.")}</p>
            </li>
          </ul>

          <h2>{t("Recopilación y Uso de Tus Datos Personales", "Collecting and Using Your Personal Data")}</h2>
          <h3>{t("Tipos de Datos Recopilados", "Types of Data Collected")}</h3>
          <h4>{t("Datos Personales", "Personal Data")}</h4>
          <p>
            {t(
              "Mientras usas Nuestro Servicio, podemos pedirte que nos proporciones cierta información de identificación personal que pueda usarse para contactarte o identificarte. Dicha información puede incluir, entre otros:",
              "While using Our Service, We may ask you to provide Us with certain personally identifiable information that can be used to contact or identify you. Such information may include, but is not limited to:"
            )}
          </p>
          <ul>
            <li>{t("Correo electrónico", "Email address")}</li>
            <li>{t("Nombre y apellido", "First name and last name")}</li>
            <li>{t("Número de teléfono", "Phone number")}</li>
          </ul>
          <h4>{t("Datos de Uso", "Usage Data")}</h4>
          <p>{t("Los Datos de Uso se recopilan automáticamente al usar el Servicio.", "Usage Data is collected automatically when using the Service.")}</p>
          <p>
            {t(
              "Los Datos de Uso pueden incluir información como la dirección IP de tu Dispositivo, tipo y versión de navegador, las páginas de nuestro Servicio que visitas, la fecha y hora de tu visita, el tiempo que pasas en esas páginas, identificadores únicos de dispositivo y otros datos de diagnóstico.",
              "Usage Data may include information such as your Device's IP address, browser type and version, the pages of our Service that you visit, the time and date of your visit, the time spent on those pages, unique device identifiers, and other diagnostic data."
            )}
          </p>
          <p>
            {t(
              "Cuando accedes al Servicio desde o a través de un dispositivo móvil, podemos recopilar automáticamente cierta información, incluyendo, entre otros, el tipo de dispositivo móvil que usas, el identificador único de tu dispositivo móvil, la dirección IP de tu dispositivo móvil, tu sistema operativo móvil, el tipo de navegador móvil que usas, identificadores únicos de dispositivo y otros datos de diagnóstico.",
              "When you access the Service by or through a mobile device, We may collect certain information automatically, including, but not limited to, the type of mobile device you use, your mobile device unique ID, the IP address of your mobile device, your mobile operating system, the type of mobile browser you use, unique device identifiers, and other diagnostic data."
            )}
          </p>
          <p>
            {t(
              "También podemos recopilar la información que tu navegador envía cada vez que visitas Nuestro Servicio o cuando accedes al Servicio desde o a través de un dispositivo móvil.",
              "We may also collect information that your browser sends whenever you visit Our Service or when you access the Service by or through a mobile device."
            )}
          </p>

          <h4>{t("Tecnologías de Rastreo y Cookies", "Tracking Technologies and Cookies")}</h4>
          <p>
            {t(
              "Usamos Cookies y tecnologías de rastreo similares para rastrear la actividad en Nuestro Servicio y almacenar cierta información. Las tecnologías de rastreo que usamos incluyen balizas, etiquetas y scripts para recopilar y rastrear información, y para mejorar y analizar Nuestro Servicio. Las tecnologías que usamos pueden incluir:",
              "We use Cookies and similar tracking technologies to track activity on Our Service and store certain information. Tracking technologies we use include beacons, tags, and scripts to collect and track information and to improve and analyze Our Service. The technologies We use may include:"
            )}
          </p>
          <ul>
            <li>
              <strong>{t("Cookies o Cookies del Navegador.", "Cookies or Browser Cookies.")}</strong>{" "}
              {t(
                "Una cookie es un pequeño archivo colocado en tu Dispositivo. Puedes indicarle a tu navegador que rechace todas las Cookies o que te avise cuando se envía una Cookie. Sin embargo, si no aceptas las Cookies, es posible que no puedas usar algunas partes de nuestro Servicio.",
                "A cookie is a small file placed on your Device. You can instruct your browser to refuse all Cookies or to indicate when a Cookie is being sent. However, if you do not accept Cookies, you may not be able to use some parts of our Service."
              )}
            </li>
            <li>
              <strong>{t("Balizas Web.", "Web Beacons.")}</strong>{" "}
              {t(
                "Ciertas secciones de nuestro Servicio y nuestros correos electrónicos pueden contener pequeños archivos electrónicos conocidos como balizas web (también llamados gifs transparentes, etiquetas de píxel y gifs de un solo píxel) que permiten a la Compañía, por ejemplo, contar los usuarios que han visitado esas páginas o abierto un correo electrónico, y obtener otras estadísticas relacionadas con el sitio web (por ejemplo, registrar la popularidad de una sección y verificar la integridad del sistema y del servidor).",
                "Certain sections of our Service and our emails may contain small electronic files known as web beacons (also referred to as clear gifs, pixel tags, and single-pixel gifs) that permit the Company to, for example, count users who have visited those pages or opened an email and for other related website statistics (for example, recording the popularity of a certain section and verifying system and server integrity)."
              )}
            </li>
          </ul>
          <p>
            {t(
              "Las Cookies pueden ser \"Persistentes\" o \"de Sesión\". Las Cookies Persistentes permanecen en tu computadora personal o dispositivo móvil cuando te desconectas, mientras que las Cookies de Sesión se eliminan tan pronto como cierras tu navegador web.",
              "Cookies can be \"Persistent\" or \"Session\" Cookies. Persistent Cookies remain on your personal computer or mobile device when you go offline, while Session Cookies are deleted as soon as you close your web browser."
            )}
          </p>
          <p>
            {t(
              "Cuando la ley lo exija, usamos cookies no esenciales (como las de análisis, publicidad y remarketing) únicamente con tu consentimiento. Puedes retirar o cambiar tu consentimiento en cualquier momento usando nuestra herramienta de preferencias de cookies (si está disponible) o a través de la configuración de tu navegador/dispositivo. Retirar el consentimiento no afecta la legalidad del procesamiento basado en el consentimiento previo a su retiro.",
              "Where required by law, we use non-essential cookies (such as analytics, advertising, and remarketing) only with your consent. You can withdraw or change your consent at any time using our cookie preference tool (if available) or through your browser/device settings. Withdrawing consent does not affect the lawfulness of processing based on consent before its withdrawal."
            )}
          </p>
          <p>{t("Usamos tanto Cookies de Sesión como Persistentes para los siguientes propósitos:", "We use both Session and Persistent Cookies for the purposes set out below:")}</p>
          <ul>
            <li>
              <p><strong>{t("Cookies Necesarias / Esenciales", "Necessary / Essential Cookies")}</strong></p>
              <p>{t("Tipo: Cookies de Sesión", "Type: Session Cookies")}</p>
              <p>{t("Administradas por: Nosotros", "Administered by: Us")}</p>
              <p>
                {t(
                  "Propósito: Estas Cookies son esenciales para brindarte los servicios disponibles a través del Sitio Web y para permitirte usar algunas de sus funciones. Ayudan a autenticar usuarios y prevenir el uso fraudulento de cuentas de usuario. Sin estas Cookies, los servicios que has solicitado no pueden prestarse, y solo usamos estas Cookies para brindarte esos servicios.",
                  "Purpose: These Cookies are essential to provide You with services available through the Website and to enable You to use some of its features. They help to authenticate users and prevent fraudulent use of user accounts. Without these Cookies, the services that You have asked for cannot be provided, and We only use these Cookies to provide You with those services."
                )}
              </p>
            </li>
            <li>
              <p><strong>{t("Cookies de Política de Cookies / Aceptación de Aviso", "Cookies Policy / Notice Acceptance Cookies")}</strong></p>
              <p>{t("Tipo: Cookies Persistentes", "Type: Persistent Cookies")}</p>
              <p>{t("Administradas por: Nosotros", "Administered by: Us")}</p>
              <p>{t("Propósito: Estas Cookies identifican si los usuarios han aceptado el uso de cookies en el Sitio Web.", "Purpose: These Cookies identify if users have accepted the use of cookies on the Website.")}</p>
            </li>
            <li>
              <p><strong>{t("Cookies de Funcionalidad", "Functionality Cookies")}</strong></p>
              <p>{t("Tipo: Cookies Persistentes", "Type: Persistent Cookies")}</p>
              <p>{t("Administradas por: Nosotros", "Administered by: Us")}</p>
              <p>
                {t(
                  "Propósito: Estas Cookies nos permiten recordar las elecciones que haces al usar el Sitio Web, como recordar tus datos de inicio de sesión o preferencia de idioma. El propósito de estas Cookies es brindarte una experiencia más personal y evitar que tengas que volver a introducir tus preferencias cada vez que usas el Sitio Web.",
                  "Purpose: These Cookies allow us to remember choices You make when You use the Website, such as remembering your login details or language preference. The purpose of these Cookies is to provide You with a more personal experience and to avoid You having to re-enter your preferences every time You use the Website."
                )}
              </p>
            </li>
          </ul>
          <p>
            {t(
              "Para más información sobre las cookies que usamos y tus opciones respecto a ellas, visita nuestra Política de Cookies o la sección de Cookies de Nuestra Política de Privacidad.",
              "For more information about the cookies we use and your choices regarding cookies, please visit our Cookies Policy or the Cookies section of our Privacy Policy."
            )}
          </p>

          <h3>{t("Uso de Tus Datos Personales", "Use of Your Personal Data")}</h3>
          <p>{t("La Compañía puede usar los Datos Personales para los siguientes propósitos:", "The Company may use Personal Data for the following purposes:")}</p>
          <ul>
            <li>
              <p><strong>{t("Para prestar y mantener nuestro Servicio", "To provide and maintain our Service")}</strong>, {t("incluyendo monitorear el uso de nuestro Servicio.", "including to monitor the usage of our Service.")}</p>
            </li>
            <li>
              <p><strong>{t("Para gestionar tu Cuenta:", "To manage Your Account:")}</strong> {t("para administrar tu registro como usuario del Servicio. Los Datos Personales que proporciones pueden darte acceso a diferentes funcionalidades del Servicio disponibles para ti como usuario registrado.", "to manage Your registration as a user of the Service. The Personal Data You provide can give You access to different functionalities of the Service that are available to You as a registered user.")}</p>
            </li>
            <li>
              <p><strong>{t("Para la ejecución de un contrato:", "For the performance of a contract:")}</strong> {t("el desarrollo, cumplimiento y ejecución del contrato de compra de los productos, artículos o servicios que hayas adquirido, o de cualquier otro contrato con Nosotros a través del Servicio.", "the development, compliance, and undertaking of the purchase contract for the products, items, or services You have purchased or of any other contract with Us through the Service.")}</p>
            </li>
            <li>
              <p><strong>{t("Para contactarte:", "To contact You:")}</strong> {t("Para contactarte por correo electrónico, llamadas telefónicas, SMS u otras formas equivalentes de comunicación electrónica, como notificaciones push de una aplicación móvil, relacionadas con actualizaciones o comunicaciones informativas sobre las funcionalidades, productos o servicios contratados, incluidas las actualizaciones de seguridad, cuando sea necesario o razonable para su implementación.", "To contact You by email, telephone calls, SMS, or other equivalent forms of electronic communication, such as a mobile application's push notifications, regarding updates or informative communications related to the functionalities, products, or contracted services, including security updates, when necessary or reasonable for their implementation.")}</p>
            </li>
            <li>
              <p><strong>{t("Para brindarte", "To provide You")}</strong> {t("noticias, ofertas especiales e información general sobre otros bienes, servicios y eventos que ofrecemos similares a los que ya has adquirido o consultado, a menos que hayas optado por no recibir dicha información.", "with news, special offers, and general information about other goods, services, and events which we offer that are similar to those that you have already purchased or enquired about, unless You have opted not to receive such information.")}</p>
            </li>
            <li>
              <p><strong>{t("Para gestionar tus solicitudes:", "To manage Your requests:")}</strong> {t("Para atender y gestionar tus solicitudes hacia Nosotros.", "To attend and manage Your requests to Us.")}</p>
            </li>
            <li>
              <p><strong>{t("Para transferencias de negocio:", "For business transfers:")}</strong> {t("Podemos usar tus Datos Personales para evaluar o llevar a cabo una fusión, escisión, reestructuración, reorganización, disolución u otra venta o transferencia de la totalidad o parte de Nuestros activos, ya sea como negocio en marcha o como parte de un proceso de quiebra, liquidación o similar, en el cual los Datos Personales en nuestro poder sobre los usuarios de nuestro Servicio se encuentren entre los activos transferidos.", "We may use Your information to evaluate or conduct a merger, divestiture, restructuring, reorganization, dissolution, or other sale or transfer of some or all of Our assets, whether as a going concern or as part of bankruptcy, liquidation, or similar proceeding, in which Personal Data held by Us about our Service users is among the assets transferred.")}</p>
            </li>
            <li>
              <p><strong>{t("Para otros propósitos", "For other purposes")}</strong>: {t("Podemos usar tu información para otros fines, como el análisis de datos, la identificación de tendencias de uso, la determinación de la eficacia de nuestras campañas promocionales, y para evaluar y mejorar nuestro Servicio, productos, servicios, marketing y tu experiencia.", "We may use Your information for other purposes, such as data analysis, identifying usage trends, determining the effectiveness of our promotional campaigns, and to evaluate and improve our Service, products, services, marketing, and your experience.")}</p>
            </li>
          </ul>
          <p>{t("Podemos compartir tus Datos Personales en las siguientes situaciones:", "We may share Your personal information in the following situations:")}</p>
          <ul>
            <li><strong>{t("Con Proveedores de Servicios:", "With Service Providers:")}</strong> {t("Podemos compartir tus Datos Personales con Proveedores de Servicios para monitorear y analizar el uso de nuestro Servicio, y para contactarte.", "We may share Your personal information with Service Providers to monitor and analyze the use of our Service, and to contact You.")}</li>
            <li><strong>{t("Para transferencias de negocio:", "For business transfers:")}</strong> {t("Podemos compartir o transferir tus Datos Personales en relación con, o durante negociaciones de, cualquier fusión, venta de activos de la Compañía, financiamiento o adquisición de la totalidad o parte de Nuestro negocio por otra compañía.", "We may share or transfer Your personal information in connection with, or during negotiations of, any merger, sale of Company assets, financing, or acquisition of all or a portion of Our business to another company.")}</li>
            <li><strong>{t("Con Afiliadas:", "With Affiliates:")}</strong> {t("Podemos compartir tus Datos Personales con Nuestras afiliadas, en cuyo caso exigiremos a esas afiliadas que respeten esta Política de Privacidad. Las Afiliadas incluyen a Nuestra empresa matriz y cualquier otra subsidiaria, socios de empresas conjuntas u otras compañías que Nosotros controlemos o que estén bajo control común con Nosotros.", "We may share Your information with Our affiliates, in which case we will require those affiliates to honor this Privacy Policy. Affiliates include Our parent company and any other subsidiaries, joint venture partners, or other companies that We control or that are under common control with Us.")}</li>
            <li><strong>{t("Con socios comerciales:", "With business partners:")}</strong> {t("Podemos compartir tus Datos Personales con Nuestros socios comerciales para ofrecerte ciertos productos, servicios o promociones.", "We may share Your information with Our business partners to offer You certain products, services, or promotions.")}</li>
            <li><strong>{t("Con otros usuarios:", "With other users:")}</strong> {t("Si Nuestro Servicio ofrece áreas públicas, cuando compartas Datos Personales o interactúes de otra forma en las áreas públicas con otros usuarios, dicha información podrá ser vista por todos los usuarios y distribuida públicamente fuera de la plataforma.", "If Our Service offers public areas, when You share personal information or otherwise interact in the public areas with other users, such information may be viewed by all users and may be publicly distributed outside the platform.")}</li>
            <li><strong>{t("Con tu consentimiento", "With Your consent")}</strong>: {t("Podemos divulgar tus Datos Personales para cualquier otro propósito con tu consentimiento.", "We may disclose Your personal information for any other purpose with Your consent.")}</li>
          </ul>

          <h3>{t("Retención de Tus Datos Personales", "Retention of Your Personal Data")}</h3>
          <p>
            {t(
              "La Compañía retendrá tus Datos Personales solo durante el tiempo necesario para los fines establecidos en esta Política de Privacidad. Retendremos y usaremos tus Datos Personales en la medida necesaria para cumplir con nuestras obligaciones legales (por ejemplo, si debemos retener tus datos para cumplir con las leyes aplicables), resolver disputas y hacer cumplir nuestros acuerdos y políticas legales.",
              "The Company will retain Your Personal Data only for as long as is necessary for the purposes set out in this Privacy Policy. We will retain and use Your Personal Data to the extent necessary to comply with our legal obligations (for example, if we are required to retain your data to comply with applicable laws), resolve disputes, and enforce our legal agreements and policies."
            )}
          </p>
          <p>
            {t(
              "Cuando sea posible, aplicamos periodos de retención más cortos y/o reducimos la identificabilidad eliminando, agregando o anonimizando los datos. Salvo que se indique lo contrario, los periodos de retención a continuación son periodos máximos (\"hasta\") y podemos eliminar o anonimizar los datos antes cuando ya no sean necesarios para el propósito correspondiente. Aplicamos diferentes periodos de retención a distintas categorías de Datos Personales según el propósito del procesamiento y las obligaciones legales:",
              "Where possible, we apply shorter retention periods and/or reduce identifiability by deleting, aggregating, or anonymizing the data. Unless otherwise stated, the retention periods below are maximum periods (\"up to\") and we may delete or anonymize data sooner when it is no longer needed for the relevant purpose. We apply different retention periods to different categories of Personal Data based on the purpose of processing and legal obligations:"
            )}
          </p>
          <ul>
            <li>
              <p>{t("Información de Cuenta", "Account Information")}</p>
              <ul>
                <li>{t("Cuentas de usuario: se conservan durante la duración de tu relación como cuenta más hasta 24 meses después del cierre de la cuenta, para gestionar cualquier asunto posterior a la terminación o resolver disputas.", "User accounts: retained for the duration of your account relationship plus up to 24 months after account closure, to handle any post-termination matters or resolve disputes.")}</li>
              </ul>
            </li>
            <li>
              <p>{t("Datos de Soporte al Cliente", "Customer Support Data")}</p>
              <ul>
                <li>{t("Tickets de soporte y correspondencia: hasta 24 meses desde la fecha de cierre del ticket, para resolver consultas de seguimiento, monitorear la calidad del servicio y defendernos frente a posibles reclamaciones legales.", "Support tickets and correspondence: up to 24 months from the ticket closing date, to resolve follow-up inquiries, monitor service quality, and defend against potential legal claims.")}</li>
                <li>{t("Transcripciones de chat: hasta 24 meses con fines de control de calidad y capacitación del personal.", "Chat transcripts: up to 24 months for quality control and staff training purposes.")}</li>
              </ul>
            </li>
            <li>
              <p>{t("Datos de Uso", "Usage Data")}</p>
              <ul>
                <li>
                  <p>{t("Datos de análisis del sitio web (cookies, direcciones IP, identificadores de dispositivo): hasta 24 meses desde la fecha de recopilación, lo que nos permite analizar tendencias respetando los principios de privacidad.", "Website analytics data (cookies, IP addresses, device identifiers): up to 24 months from the date of collection, allowing us to analyze trends while respecting privacy principles.")}</p>
                </li>
                <li>
                  <p>{t("Estadísticas de uso de la aplicación: hasta 24 meses para entender la adopción de funciones y las mejoras del servicio.", "Application usage statistics: up to 24 months to understand feature adoption and service improvements.")}</p>
                </li>
                <li>
                  <p>{t("Registros de servidor (direcciones IP, horarios de acceso): hasta 24 meses con fines de monitoreo de seguridad y resolución de problemas.", "Server logs (IP addresses, access times): up to 24 months for security monitoring and troubleshooting purposes.")}</p>
                </li>
              </ul>
            </li>
          </ul>
          <p>
            {t(
              "Los Datos de Uso se conservan de acuerdo con los periodos de retención descritos anteriormente, y solo podrán conservarse por más tiempo cuando sea necesario por motivos de seguridad, prevención de fraude o cumplimiento legal.",
              "Usage Data is retained in accordance with the retention periods described above, and may only be kept longer when necessary for security, fraud prevention, or legal compliance reasons."
            )}
          </p>
          <p>{t("Podemos retener Datos Personales más allá de los periodos indicados anteriormente por diferentes razones:", "We may retain Personal Data beyond the periods indicated above for different reasons:")}</p>
          <ul>
            <li>{t("Obligación legal: La ley nos exige retener datos específicos (por ejemplo, registros financieros para autoridades fiscales).", "Legal obligation: The law requires us to retain specific data (for example, financial records for tax authorities).")}</li>
            <li>{t("Reclamaciones legales: Los datos son necesarios para establecer, ejercer o defender reclamaciones legales.", "Legal claims: The data is necessary to establish, exercise, or defend legal claims.")}</li>
            <li>{t("Tu solicitud explícita: Nos pides que conservemos información específica.", "Your explicit request: You ask us to retain specific information.")}</li>
            <li>{t("Limitaciones técnicas: Los datos existen en sistemas de respaldo programados para eliminación rutinaria.", "Technical limitations: The data exists in backup systems scheduled for routine deletion.")}</li>
          </ul>
          <p>{t("Puedes solicitar información sobre cuánto tiempo conservaremos tus Datos Personales contactándonos.", "You can request information about how long we will retain your Personal Data by contacting us.")}</p>
          <p>
            {t(
              "Cuando expiran los periodos de retención, eliminamos o anonimizamos de forma segura los Datos Personales según los siguientes procedimientos:",
              "When retention periods expire, we securely delete or anonymize Personal Data following these procedures:"
            )}
          </p>
          <ul>
            <li>{t("Eliminación: Los Datos Personales se eliminan de Nuestros sistemas y dejan de procesarse activamente.", "Deletion: Personal Data is removed from Our systems and stops being actively processed.")}</li>
            <li>{t("Retención en respaldos: Pueden quedar copias residuales en respaldos cifrados durante un periodo limitado, conforme a nuestro cronograma de retención de respaldos, y no se restauran salvo que sea necesario por seguridad, recuperación ante desastres o cumplimiento legal.", "Backup retention: Residual copies may remain in encrypted backups for a limited period, in accordance with our backup retention schedule, and are not restored unless necessary for security, disaster recovery, or legal compliance.")}</li>
            <li>{t("Anonimización: En algunos casos, convertimos los Datos Personales en datos estadísticos anónimos que no pueden vincularse contigo. Estos datos anonimizados pueden conservarse indefinidamente para fines de investigación y análisis.", "Anonymization: In some cases, we convert Personal Data into anonymous statistical data that cannot be linked to you. This anonymized data may be retained indefinitely for research and analysis purposes.")}</li>
          </ul>

          <h3>{t("Transferencia de Tus Datos Personales", "Transfer of Your Personal Data")}</h3>
          <p>
            {t(
              "Tu información, incluidos tus Datos Personales, se procesa en las oficinas operativas de la Compañía y en cualquier otro lugar donde se encuentren las partes involucradas en el procesamiento. Esto significa que dicha información puede transferirse a — y mantenerse en — computadoras ubicadas fuera de tu estado, provincia, país u otra jurisdicción gubernamental donde las leyes de protección de datos puedan diferir de las de tu jurisdicción.",
              "Your information, including Personal Data, is processed at the Company's operating offices and in any other places where the parties involved in the processing are located. This means that this information may be transferred to — and maintained on — computers located outside of your state, province, country, or other governmental jurisdiction where the data protection laws may differ from those of your jurisdiction."
            )}
          </p>
          <p>
            {t(
              "Cuando la ley aplicable lo exija, nos aseguraremos de que las transferencias internacionales de tus Datos Personales estén sujetas a las salvaguardas y medidas complementarias adecuadas cuando corresponda. La Compañía tomará todas las medidas razonablemente necesarias para garantizar que tus datos sean tratados de forma segura y de acuerdo con esta Política de Privacidad, y no se realizará ninguna transferencia de tus Datos Personales a una organización o país a menos que existan controles adecuados, incluida la seguridad de tus datos y demás información personal.",
              "Where required by applicable law, We will ensure that international transfers of Your Personal Data are subject to appropriate safeguards and supplementary measures where applicable. The Company will take all steps reasonably necessary to ensure that Your data is treated securely and in accordance with this Privacy Policy, and no transfer of Your Personal Data will take place to an organization or a country unless there are adequate controls in place, including the security of Your data and other personal information."
            )}
          </p>

          <h3>{t("Eliminar Tus Datos Personales", "Delete Your Personal Data")}</h3>
          <p>{t("Tienes derecho a eliminar o solicitar que te ayudemos a eliminar los Datos Personales que hemos recopilado sobre ti.", "You have the right to delete or request that We assist in deleting the Personal Data that We have collected about You.")}</p>
          <p>{t("Nuestro Servicio puede darte la posibilidad de eliminar cierta información sobre ti desde dentro del propio Servicio.", "Our Service may give You the ability to delete certain information about You from within the Service.")}</p>
          <p>
            {t(
              "Puedes actualizar, modificar o eliminar tu información en cualquier momento iniciando sesión en tu Cuenta, si tienes una, y accediendo a la sección de configuración de cuenta que te permite gestionar tu información personal. También puedes contactarnos para solicitar acceso, corrección o eliminación de cualquier Dato Personal que nos hayas proporcionado.",
              "You may update, amend, or delete Your information at any time by signing in to Your Account, if you have one, and visiting the account settings section that allows you to manage Your personal information. You may also contact Us to request access to, correct, or delete any personal information that You have provided to Us."
            )}
          </p>
          <p>{t("Ten en cuenta, sin embargo, que podemos necesitar conservar cierta información cuando tengamos una obligación legal o base legal para hacerlo.", "Please note, however, that We may need to retain certain information when we have a legal obligation or lawful basis to do so.")}</p>

          <h3>{t("Divulgación de Tus Datos Personales", "Disclosure of Your Personal Data")}</h3>
          <h4>{t("Transacciones Comerciales", "Business Transactions")}</h4>
          <p>
            {t(
              "Si la Compañía se ve involucrada en una fusión, adquisición o venta de activos, tus Datos Personales podrán ser transferidos. Te notificaremos antes de que tus Datos Personales sean transferidos y queden sujetos a una Política de Privacidad diferente.",
              "If the Company is involved in a merger, acquisition, or asset sale, Your Personal Data may be transferred. We will provide notice before Your Personal Data is transferred and becomes subject to a different Privacy Policy."
            )}
          </p>
          <h4>{t("Cumplimiento de la ley", "Law enforcement")}</h4>
          <p>
            {t(
              "Bajo ciertas circunstancias, la Compañía podrá verse obligada a divulgar tus Datos Personales si así lo exige la ley o en respuesta a solicitudes válidas de autoridades públicas (por ejemplo, un tribunal o una agencia gubernamental).",
              "Under certain circumstances, the Company may be required to disclose Your Personal Data if required to do so by law or in response to valid requests by public authorities (e.g., a court or a government agency)."
            )}
          </p>
          <h4>{t("Otros requisitos legales", "Other legal requirements")}</h4>
          <p>{t("La Compañía puede divulgar tus Datos Personales de buena fe, cuando considere que dicha acción es necesaria para:", "The Company may disclose Your Personal Data in the good faith belief that such action is necessary to:")}</p>
          <ul>
            <li>{t("Cumplir con una obligación legal", "Comply with a legal obligation")}</li>
            <li>{t("Proteger y defender los derechos o la propiedad de la Compañía", "Protect and defend the rights or property of the Company")}</li>
            <li>{t("Prevenir o investigar posibles irregularidades relacionadas con el Servicio", "Prevent or investigate possible wrongdoing in connection with the Service")}</li>
            <li>{t("Proteger la seguridad personal de los Usuarios del Servicio o del público", "Protect the personal safety of Users of the Service or the public")}</li>
            <li>{t("Protegernos contra responsabilidad legal", "Protect against legal liability")}</li>
          </ul>

          <h3>{t("Seguridad de Tus Datos Personales", "Security of Your Personal Data")}</h3>
          <p>
            {t(
              "La seguridad de tus Datos Personales es importante para Nosotros, pero recuerda que ningún método de transmisión por Internet ni método de almacenamiento electrónico es 100% seguro. Si bien nos esforzamos por usar medios comercialmente razonables para proteger tus Datos Personales, no podemos garantizar su seguridad absoluta.",
              "The security of Your Personal Data is important to Us, but remember that no method of transmission over the Internet, or method of electronic storage, is 100% secure. While We strive to use commercially acceptable means to protect Your Personal Data, We cannot guarantee its absolute security."
            )}
          </p>

          <h2>{t("Privacidad de los Niños", "Children's Privacy")}</h2>
          <p>
            {t(
              "Nuestro Servicio no está dirigido a personas menores de 16 años. No recopilamos a sabiendas información de identificación personal de personas menores de 16 años. Si eres padre, madre o tutor y tienes conocimiento de que tu hijo o hija nos ha proporcionado Datos Personales, por favor contáctanos. Si tomamos conocimiento de que hemos recopilado Datos Personales de alguien menor de 16 años sin verificación del consentimiento parental, tomaremos medidas para eliminar esa información de nuestros servidores.",
              "Our Service does not address anyone under the age of 16. We do not knowingly collect personally identifiable information from anyone under the age of 16. If You are a parent or guardian and You are aware that Your child has provided Us with Personal Data, please contact Us. If We become aware that We have collected Personal Data from anyone under the age of 16 without verification of parental consent, We take steps to remove that information from Our servers."
            )}
          </p>
          <p>
            {t(
              "Si necesitamos basarnos en el consentimiento como fundamento legal para procesar tu información, y tu país exige el consentimiento de un padre o tutor, podremos requerir dicho consentimiento antes de recopilar y usar esa información.",
              "If We need to rely on consent as a legal basis for processing Your information and Your country requires consent from a parent, We may require Your parent's consent before We collect and use that information."
            )}
          </p>

          <h2>{t("Enlaces a Otros Sitios Web", "Links to Other Websites")}</h2>
          <p>
            {t(
              "Nuestro Servicio puede contener enlaces a otros sitios web que no son operados por Nosotros. Si haces clic en un enlace de un tercero, serás dirigido al sitio de ese tercero. Te recomendamos encarecidamente revisar la Política de Privacidad de cada sitio que visites.",
              "Our Service may contain links to other websites that are not operated by Us. If You click on a third-party link, You will be directed to that third party's site. We strongly advise You to review the Privacy Policy of every site You visit."
            )}
          </p>
          <p>{t("No tenemos control sobre y no asumimos responsabilidad alguna por el contenido, las políticas de privacidad o las prácticas de sitios o servicios de terceros.", "We have no control over and assume no responsibility for the content, privacy policies, or practices of any third-party sites or services.")}</p>

          <h2>{t("Cambios a esta Política de Privacidad", "Changes to this Privacy Policy")}</h2>
          <p>{t("Podemos actualizar Nuestra Política de Privacidad de vez en cuando. Te notificaremos cualquier cambio publicando la nueva Política de Privacidad en esta página.", "We may update Our Privacy Policy from time to time. We will notify You of any changes by posting the new Privacy Policy on this page.")}</p>
          <p>
            {t(
              "Te informaremos por correo electrónico y/o mediante un aviso destacado en Nuestro Servicio, antes de que el cambio entre en vigor, y actualizaremos la fecha de \"Última actualización\" en la parte superior de esta Política de Privacidad.",
              "We will let You know via email and/or a prominent notice on Our Service, prior to the change becoming effective, and update the \"Last updated\" date at the top of this Privacy Policy."
            )}
          </p>
          <p>{t("Se te recomienda revisar esta Política de Privacidad periódicamente para verificar cualquier cambio. Los cambios a esta Política de Privacidad entran en vigor cuando se publican en esta página.", "You are advised to review this Privacy Policy periodically for any changes. Changes to this Privacy Policy are effective when they are posted on this page.")}</p>

          <h2>{t("Contáctanos", "Contact Us")}</h2>
          <p>{t("Si tienes alguna pregunta sobre esta Política de Privacidad, puedes contactarnos:", "If you have any questions about this Privacy Policy, You can contact us:")}</p>
          <ul>
            <li>{t("Por correo electrónico:", "By email:")} vandusfor@gmail.com</li>
          </ul>
        </article>
      </div>
    </main>
  );
}
