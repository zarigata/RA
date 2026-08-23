// src/languages.ts — 20+ language packs for localization (pure, testable)

export interface LanguagePack {
  code: string;
  name: string;
  nativeName: string;
  messages: {
    welcome: string;
    sessionComplete: string;
    sessionError: string;
    lanScanStart: string;
    noLanFound: string;
    costTotal: string;
    rolesHeader: string;
  };
}

const LANGUAGE_PACKS: Record<string, LanguagePack> = {
  en: {
    code: "en",
    name: "English",
    nativeName: "English",
    messages: {
      welcome: "Anubis — Mixture-of-Agents terminal agent",
      sessionComplete: "Session complete",
      sessionError: "Session error",
      lanScanStart: "Scanning subnet for model servers",
      noLanFound: "No LAN model servers found.",
      costTotal: "TOTAL",
      rolesHeader: "ROLE        MODEL                          SOURCE",
    },
  },
  pt: {
    code: "pt",
    name: "Portuguese",
    nativeName: "Português",
    messages: {
      welcome: "Anubis — Agente terminal de Mistura de Agentes",
      sessionComplete: "Sessão concluída",
      sessionError: "Erro na sessão",
      lanScanStart: "Varrendo sub-rede em busca de servidores de modelos",
      noLanFound: "Nenhum servidor de modelo LAN encontrado.",
      costTotal: "TOTAL",
      rolesHeader: "PAPEL       MODELO                         ORIGEM",
    },
  },
  es: {
    code: "es",
    name: "Spanish",
    nativeName: "Español",
    messages: {
      welcome: "Anubis — Agente terminal de Mezcla de Agentes",
      sessionComplete: "Sesión completa",
      sessionError: "Error de sesión",
      lanScanStart: "Escaneando subred en busca de servidores de modelos",
      noLanFound: "No se encontraron servidores de modelos LAN.",
      costTotal: "TOTAL",
      rolesHeader: "ROL         MODELO                         ORIGEN",
    },
  },
  fr: {
    code: "fr",
    name: "French",
    nativeName: "Français",
    messages: {
      welcome: "Anubis — Agent terminal de Mélange d'Agents",
      sessionComplete: "Session terminée",
      sessionError: "Erreur de session",
      lanScanStart: "Analyse du sous-réseau pour les serveurs de modèles",
      noLanFound: "Aucun serveur de modèle LAN trouvé.",
      costTotal: "TOTAL",
      rolesHeader: "RÔLE        MODÈLE                         SOURCE",
    },
  },
  de: {
    code: "de",
    name: "German",
    nativeName: "Deutsch",
    messages: {
      welcome: "Anubis — Mixture-of-Agents Terminal-Agent",
      sessionComplete: "Sitzung beendet",
      sessionError: "Sitzungsfehler",
      lanScanStart: "Scanne Subnetz nach Modellservern",
      noLanFound: "Keine LAN-Modellserver gefunden.",
      costTotal: "GESAMT",
      rolesHeader: "ROLLE       MODELL                         QUELLE",
    },
  },
  ja: {
    code: "ja",
    name: "Japanese",
    nativeName: "日本語",
    messages: {
      welcome: "Anubis — 混合エージェント端末エージェント",
      sessionComplete: "セッション完了",
      sessionError: "セッションエラー",
      lanScanStart: "モデルサーバーのサブネットスキャン中",
      noLanFound: "LANモデルサーバーが見つかりません。",
      costTotal: "合計",
      rolesHeader: "ロール      モデル                         ソース",
    },
  },
  zh: {
    code: "zh",
    name: "Chinese",
    nativeName: "中文",
    messages: {
      welcome: "Anubis — 混合智能体终端代理",
      sessionComplete: "会话完成",
      sessionError: "会话错误",
      lanScanStart: "正在扫描子网以查找模型服务器",
      noLanFound: "未找到局域网模型服务器。",
      costTotal: "总计",
      rolesHeader: "角色        模型                           来源",
    },
  },
  it: {
    code: "it",
    name: "Italian",
    nativeName: "Italiano",
    messages: {
      welcome: "Anubis — Agente terminale a Miscela di Agenti",
      sessionComplete: "Sessione completata",
      sessionError: "Errore di sessione",
      lanScanStart: "Scansione della sottorete per server di modelli",
      noLanFound: "Nessun server di modelli LAN trovato.",
      costTotal: "TOTALE",
      rolesHeader: "RUOLO       MODELLO                        ORIGINE",
    },
  },
  ru: {
    code: "ru",
    name: "Russian",
    nativeName: "Русский",
    messages: {
      welcome: "Anubis — Терминальный агент смеси агентов",
      sessionComplete: "Сеанс завершен",
      sessionError: "Ошибка сеанса",
      lanScanStart: "Сканирование подсети на наличие серверов моделей",
      noLanFound: "LAN-серверы моделей не найдены.",
      costTotal: "ИТОГО",
      rolesHeader: "РОЛЬ        МОДЕЛЬ                         ИСТОЧНИК",
    },
  },
  ar: {
    code: "ar",
    name: "Arabic",
    nativeName: "العربية",
    messages: {
      welcome: "أنوبيس — وكيل طرفي خليط الوكلاء",
      sessionComplete: "اكتملت الجلسة",
      sessionError: "خطأ في الجلسة",
      lanScanStart: "جاري فحص الشبكة الفرعية بحثاً عن خوادم النماذج",
      noLanFound: "لم يتم العثور على خوادم نماذج محلية.",
      costTotal: "المجموع",
      rolesHeader: "الدور       النموذج                        المصدر",
    },
  },
  hi: {
    code: "hi",
    name: "Hindi",
    nativeName: "हिन्दी",
    messages: {
      welcome: "Anubis — मिक्सचर-ऑफ-एजेंट्स टर्मिनल एजेंट",
      sessionComplete: "सत्र पूर्ण हुआ",
      sessionError: "सत्र त्रुटि",
      lanScanStart: "मॉडल सर्वर के लिए सबनेट स्कैन किया जा रहा है",
      noLanFound: "कोई LAN मॉडल सर्वर नहीं मिला।",
      costTotal: "कुल",
      rolesHeader: "भूमिका      मॉडल                          स्रोत",
    },
  },
  ko: {
    code: "ko",
    name: "Korean",
    nativeName: "한국어",
    messages: {
      welcome: "Anubis — 혼합 에이전트 터미널 에이전트",
      sessionComplete: "세션 완료",
      sessionError: "세션 오류",
      lanScanStart: "모델 서버 서브넷 스캔 중",
      noLanFound: "LAN 모델 서버를 찾을 수 없습니다.",
      costTotal: "총계",
      rolesHeader: "역할        모델                           소스",
    },
  },
  nl: {
    code: "nl",
    name: "Dutch",
    nativeName: "Nederlands",
    messages: {
      welcome: "Anubis — Mixture-of-Agents terminale agent",
      sessionComplete: "Sessie voltooid",
      sessionError: "Sessiefout",
      lanScanStart: "Subnet scannen op modelservers",
      noLanFound: "Geen LAN-modelservers gevonden.",
      costTotal: "TOTAAL",
      rolesHeader: "ROL         MODEL                          BRON",
    },
  },
  pl: {
    code: "pl",
    name: "Polish",
    nativeName: "Polski",
    messages: {
      welcome: "Anubis — Agent terminalowy Mixture-of-Agents",
      sessionComplete: "Sesja zakończona",
      sessionError: "Błąd sesji",
      lanScanStart: "Skanowanie podsieci w poszukiwaniu serwerów modeli",
      noLanFound: "Nie znaleziono serwerów modeli LAN.",
      costTotal: "SUMA",
      rolesHeader: "ROLA        MODEL                          ŹRÓDŁO",
    },
  },
  sv: {
    code: "sv",
    name: "Swedish",
    nativeName: "Svenska",
    messages: {
      welcome: "Anubis — Mixture-of-Agents terminalagent",
      sessionComplete: "Session slutförd",
      sessionError: "Sessionsfel",
      lanScanStart: "Skannar subnät efter modellservrar",
      noLanFound: "Inga LAN-modellservrar hittades.",
      costTotal: "TOTALT",
      rolesHeader: "ROLL        MODELL                         KÄLLA",
    },
  },
  tr: {
    code: "tr",
    name: "Turkish",
    nativeName: "Türkçe",
    messages: {
      welcome: "Anubis — Ajan Karması Terminal Ajanı",
      sessionComplete: "Oturum tamamlandı",
      sessionError: "Oturum hatası",
      lanScanStart: "Model sunucuları için alt ağ taranıyor",
      noLanFound: "LAN model sunucusu bulunamadı.",
      costTotal: "TOPLAM",
      rolesHeader: "ROL         MODEL                          KAYNAK",
    },
  },
  vi: {
    code: "vi",
    name: "Vietnamese",
    nativeName: "Tiếng Việt",
    messages: {
      welcome: "Anubis — Tác nhân đầu cuối Mixture-of-Agents",
      sessionComplete: "Phiên hoàn tất",
      sessionError: "Lỗi phiên",
      lanScanStart: "Đang quét mạng con tìm máy chủ mô hình",
      noLanFound: "Không tìm thấy máy chủ mô hình LAN nào.",
      costTotal: "TỔNG CỘNG",
      rolesHeader: "VAI TRÒ     MÔ HÌNH                        NGUỒN",
    },
  },
  uk: {
    code: "uk",
    name: "Ukrainian",
    nativeName: "Українська",
    messages: {
      welcome: "Anubis — Термінальний агент суміші агентів",
      sessionComplete: "Сеанс завершено",
      sessionError: "Помилка сеансу",
      lanScanStart: "Сканування підмережі на наявність серверів моделей",
      noLanFound: "Сервери моделей LAN не знайдено.",
      costTotal: "РАЗОМ",
      rolesHeader: "РОЛЬ        МОДЕЛЬ                         ДЖЕРЕЛО",
    },
  },
  el: {
    code: "el",
    name: "Greek",
    nativeName: "Ελληνικά",
    messages: {
      welcome: "Anubis — Πعراკ Terminal Agent Mixture-of-Agents",
      sessionComplete: "Η συνεδρία ολοκληρώθηκε",
      sessionError: "Σφάλμα συνεδρίας",
      lanScanStart: "Σάρωση υποdiktýou για διακομιστές μοντέλων",
      noLanFound: "Δεν βρέθηκαν διακομιστές μοντέλων LAN.",
      costTotal: "ΣΥΝΟΛΟ",
      rolesHeader: "ΡΟΛΟΣ       ΜΟΝΤΕΛΟ                        ΠΗΓΗ",
    },
  },
  cs: {
    code: "cs",
    name: "Czech",
    nativeName: "Čeština",
    messages: {
      welcome: "Anubis — Terminálový agent Mixture-of-Agents",
      sessionComplete: "Relace dokončena",
      sessionError: "Chyba relace",
      lanScanStart: "Skenování podsíťe pro servery modelů",
      noLanFound: "Nebyly nalezeny žádné LAN servery modelů.",
      costTotal: "CELKEM",
      rolesHeader: "ROLE        MODEL                          ZDROJ",
    },
  },
  ro: {
    code: "ro",
    name: "Romanian",
    nativeName: "Română",
    messages: {
      welcome: "Anubis — Agent de terminal Mixture-of-Agents",
      sessionComplete: "Sesiune finalizată",
      sessionError: "Eroare de sesiune",
      lanScanStart: "Se scanează subrețeaua pentru servere de modele",
      noLanFound: "Nu s-au găsit servere de modele LAN.",
      costTotal: "TOTAL",
      rolesHeader: "ROL         MODEL                          SURSĂ",
    },
  },
  da: {
    code: "da",
    name: "Danish",
    nativeName: "Dansk",
    messages: {
      welcome: "Anubis — Mixture-of-Agents terminalagent",
      sessionComplete: "Session fuldført",
      sessionError: "Sessionsfejl",
      lanScanStart: "Skanner subnet for modelservere",
      noLanFound: "Ingen LAN-modelservere fundet.",
      costTotal: "I ALT",
      rolesHeader: "ROLLE       MODEL                          KILDE",
    },
  },
};

export function getLanguagePack(code: string): LanguagePack {
  return LANGUAGE_PACKS[code.toLowerCase()] ?? LANGUAGE_PACKS["en"];
}

export function listLanguagePacks(): LanguagePack[] {
  return Object.values(LANGUAGE_PACKS);
}

export function translate(langCode: string, key: keyof LanguagePack["messages"]): string {
  const pack = getLanguagePack(langCode);
  return pack.messages[key] ?? LANGUAGE_PACKS["en"].messages[key];
}
