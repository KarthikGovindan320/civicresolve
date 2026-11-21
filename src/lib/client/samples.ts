/**
 * Example reports for the "Try a sample report" button, so a first-time
 * visitor can see the whole flow without typing. They are realistic Vellore
 * issues of different urgency, and two are written in Tamil and Hindi to show
 * that reports in any language are understood.
 */
export interface SampleReport {
  /** Language the sample is written in. */
  lang: "en" | "ta" | "hi";
  title: string;
  description: string;
  /** Landmark shown in the address field. */
  address: string;
  lat: number;
  lng: number;
}

export const SAMPLE_REPORTS: readonly SampleReport[] = [
  {
    lang: "en",
    title: "Deep pothole near Katpadi bus stand",
    description:
      "There is a large pothole, almost a foot deep, on the main road just outside Katpadi bus stand. " +
      "It has been there for over two weeks and fills with water when it rains, so two-wheelers cannot see it. " +
      "I saw a scooter skid there yesterday evening.",
    address: "Outside Katpadi bus stand, Katpadi, Vellore",
    lat: 12.9698,
    lng: 79.1378,
  },
  {
    lang: "ta",
    title: "நேதாஜி மார்க்கெட் அருகே குப்பைத் தொட்டி நிரம்பி வழிகிறது",
    description:
      "நேதாஜி மார்க்கெட் நுழைவாயில் அருகே உள்ள குப்பைத் தொட்டி நான்கு நாட்களாக அகற்றப்படவில்லை. " +
      "குப்பை சாலை வரை கொட்டிக் கிடக்கிறது, துர்நாற்றம் தாங்க முடியவில்லை. " +
      "தெரு நாய்களும் மாடுகளும் குப்பையைக் கிளறுகின்றன; காய்கறி வாங்க வருபவர்களுக்கு மிகவும் சிரமமாக உள்ளது.",
    address: "நேதாஜி மார்க்கெட் நுழைவாயில், லாங்கு பஜார், வேலூர்",
    lat: 12.9212,
    lng: 79.1338,
  },
  {
    lang: "en",
    title: "Fallen electric wire sparking near school bus stop",
    description:
      "A live electric wire has snapped and is lying on the footpath next to the school bus stop in Sathuvachari. " +
      "It is sparking, and children wait here every morning and evening. " +
      "Please cut the power and fix it urgently before someone gets hurt.",
    address: "School bus stop, Phase 2, Sathuvachari, Vellore",
    lat: 12.9366,
    lng: 79.1596,
  },
  {
    lang: "hi",
    title: "वीआईटी मेन गेट के पास पानी की पाइप फटी है",
    description:
      "वीआईटी मेन गेट के सामने सड़क किनारे पीने के पानी की पाइपलाइन फट गई है। " +
      "कल रात से लगातार पानी बह रहा है और सड़क पर भर गया है। " +
      "बहुत पानी बर्बाद हो रहा है और पैदल चलने वालों को दिक्कत हो रही है।",
    address: "वीआईटी मेन गेट के सामने, काटपाडी रोड, वेल्लोर",
    lat: 12.9692,
    lng: 79.1559,
  },
];

/** The sample to show for the nth click; clicks beyond the last sample start again from the first. */
export const sampleAt = (clickIndex: number): SampleReport =>
  SAMPLE_REPORTS[((clickIndex % SAMPLE_REPORTS.length) + SAMPLE_REPORTS.length) % SAMPLE_REPORTS.length];
