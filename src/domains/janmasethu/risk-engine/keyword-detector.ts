export enum RiskLevel {
    GREEN = 'GREEN',
    YELLOW = 'YELLOW',
    RED = 'RED',
}

export const EMERGENCY_KEYWORDS = [
    'bleeding heavily', 'heavy bleeding', 'continuous bleeding', 'bleeding with clots', 'large clots',
    'soaking pad quickly', 'bleeding with pain', 'bright red bleeding', 'dark red bleeding', 'hemorrhage',
    'uncontrolled bleeding', 'severe abdominal pain', 'unbearable pain', 'sharp stabbing pain',
    'intense cramps', 'pain not stopping', 'pain getting worse', 'sudden severe pain',
    'lower abdomen severe pain', 'pelvic severe pain', 'back pain severe', 'no baby movement',
    'baby not moving', 'stopped feeling kicks', 'reduced fetal movement suddenly', 'no movement today',
    'water broke', 'water leaking', 'fluid leaking continuously', 'gush of fluid', 'premature rupture',
    'severe headache pregnancy', 'blurred vision', 'vision loss', 'seeing spots', 'swelling face sudden',
    'swelling hands sudden', 'very high bp', 'preeclampsia symptoms', 'hypertension pregnancy',
    'fainting', 'unconscious', 'loss of consciousness', 'collapsed', 'cannot stand', 'seizures',
    'fits', 'convulsions', 'breathlessness severe', 'difficulty breathing', 'gasping for air',
    'cannot breathe', 'chest pain', 'tight chest', 'heart racing fast', 'irregular heartbeat',
    'miscarriage', 'pregnancy loss', 'lost baby', 'no heartbeat', 'fetus not viable',
    'passing tissue', 'sac passed', 'severe vomiting', 'vomiting blood', 'unable to keep fluids',
    'high fever', 'fever very high', 'fever with chills severe', 'confusion', 'disoriented', 'not responding'
];

export const MODERATE_KEYWORDS = [
    'mild abdominal pain', 'moderate pain', 'cramps', 'period-like cramps', 'back pain pregnancy',
    'lower back ache', 'pelvic discomfort', 'pressure in abdomen', 'tightening feeling',
    'pulling sensation', 'intermittent pain', 'pain comes and goes', 'pain while walking',
    'nausea', 'nausea all day', 'vomiting frequently', 'vomiting after eating', 'loss of appetite',
    'cannot eat properly', 'weakness', 'fatigue', 'tired all the time', 'dizziness',
    'lightheaded', 'feeling faint', 'fever', 'low grade fever', 'chills', 'burning urination',
    'pain while urinating', 'frequent urination', 'cloudy urine', 'abnormal discharge',
    'white discharge', 'yellow discharge', 'green discharge', 'foul smell discharge',
    'itching vaginal', 'spotting', 'light bleeding', 'brown discharge', 'swelling legs',
    'swelling feet', 'mild swelling hands', 'baby movement less', 'baby movement decreased',
    'less kicks', 'irregular periods', 'missed period', 'late period', 'cycle delay',
    'irregular cycle', 'not conceiving', 'trying for months', 'infertility concerns',
    'ovulation issues', 'missed ovulation', 'pcos symptoms', 'hormonal imbalance',
    'thyroid issues', 'emotional stress', 'feeling anxious', 'worried', 'overthinking',
    'fear about pregnancy', 'panic', 'crying', 'mood swings', 'feeling low', 'sleep issues',
    'not sleeping well', 'insomnia', 'dehydration', 'dry mouth'
];

export const INFORMATIONAL_KEYWORDS = [
    'is this normal', 'is it safe', 'can i eat this', 'what to eat', 'what to avoid',
    'diet during pregnancy', 'pregnancy food', 'healthy foods', 'safe exercises',
    'walking safe', 'yoga pregnancy', 'exercise routine', 'baby growth', 'baby size this week',
    'baby development', 'baby kicking normal', 'baby active', 'normal cramps',
    'mild discomfort normal', 'body changes', 'due date', 'due date calculation',
    'weeks of pregnancy', 'trimester info', 'weight gain normal', 'weight tracking',
    'scan schedule', 'checkup schedule', 'doctor visit', 'test results', 'reports normal',
    'supplements', 'iron tablets', 'calcium tablets', 'vitamins', 'hydration',
    'drinking water', 'breastfeeding tips', 'milk supply', 'latching baby',
    'baby feeding', 'baby sleeping', 'baby routine', 'newborn care', 'post delivery recovery',
    'c section recovery', 'stitches healing', 'feeling good', 'feeling better',
    'feeling normal', 'happy', 'relieved', 'excited', 'thankful', 'baby is active',
    'baby kicking well', 'healthy baby', 'normal report', 'everything fine',
    'planning pregnancy', 'trying to conceive', 'fertility planning', 'ovulation tracking'
];

export class KeywordDetector {
    detect(text: string): { level: RiskLevel; tags: string[] } {
        const lower = text.toLowerCase();
        const tags: string[] = [];

        // 1. High Risk (RED)
        const emergencies = EMERGENCY_KEYWORDS.filter((kw) => lower.includes(kw));
        if (emergencies.length > 0) {
            return { level: RiskLevel.RED, tags: emergencies.map(t => t.toUpperCase()) };
        }

        // 2. Moderate Risk (YELLOW)
        const moderates = MODERATE_KEYWORDS.filter((kw) => lower.includes(kw));
        if (moderates.length > 0) {
            return { level: RiskLevel.YELLOW, tags: moderates.map(t => t.toUpperCase()) };
        }

        // 3. Low Risk / Informational (GREEN)
        const informational = INFORMATIONAL_KEYWORDS.filter((kw) => lower.includes(kw));
        if (informational.length > 0) {
            return { level: RiskLevel.GREEN, tags: informational.map(t => t.toUpperCase()) };
        }

        return { level: RiskLevel.GREEN, tags: [] };
    }
}
