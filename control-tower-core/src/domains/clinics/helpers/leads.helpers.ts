// Valid lead_status enum values from database
export const VALID_STATUSES = ['New Inquiry', 'Follow Up', 'Converted', 'Not Interested', 'Lost'];

// Common source values that might mistakenly be put into status field
export const SOURCE_VALUES = ['Walk-In', 'Walk-in', 'Website', 'website', 'Referral', 'referral', 'Social Media', 'Phone Call'];

export function normalizeStatus(rawStatus: string | undefined | null): string {
    if (!rawStatus) return 'New Inquiry';
    const trimmed = rawStatus.trim();
    const matchedStatus = VALID_STATUSES.find(s => s.toLowerCase() === trimmed.toLowerCase());
    if (matchedStatus) return matchedStatus;
    const statusMap: Record<string, string> = {
        'new': 'New Inquiry', 'new inquiry': 'New Inquiry', 'inquiry': 'New Inquiry',
        'contacted': 'Follow Up', 'follow up': 'Follow Up', 'followup': 'Follow Up', 'follow-up': 'Follow Up',
        'converted': 'Converted', 'won': 'Converted', 'closed': 'Converted',
        'not interested': 'Not Interested', 'notinterested': 'Not Interested',
        'lost': 'Lost', 'dead': 'Lost',
    };
    const mapped = statusMap[trimmed.toLowerCase()];
    if (mapped) return mapped;
    if (SOURCE_VALUES.some(s => s.toLowerCase() === trimmed.toLowerCase())) return 'New Inquiry';
    return 'New Inquiry';
}

export function looksLikeSource(value: string | undefined | null): boolean {
    if (!value) return false;
    return SOURCE_VALUES.some(s => s.toLowerCase() === value.trim().toLowerCase());
}

export function looksLikeStatus(value: string | undefined | null): boolean {
    if (!value) return false;
    const trimmed = value.trim().toLowerCase();
    if (VALID_STATUSES.some(s => s.toLowerCase() === trimmed)) return true;
    const statusPatterns = [
        'new', 'inquiry', 'new inquiry', 'contacted', 'follow up', 'followup', 'follow-up',
        'converted', 'won', 'closed', 'not interested', 'notinterested', 'lost', 'dead',
        'stalling', 'stalling - sent to cro', 'stalling-sent to cro', 'sent to cro',
        'pending', 'in progress', 'inprogress', 'qualified', 'unqualified', 'hot', 'warm', 'cold',
        'bulk import', 'imported',
    ];
    return statusPatterns.includes(trimmed) || trimmed.includes('stalling') || trimmed.includes('inquiry');
}

// Column name mapping: maps various CSV column names to our database field names
export const COLUMN_MAPPINGS: Record<string, string> = {
    'name': 'name', 'Name': 'name', 'NAME': 'name', 'fullname': 'name', 'full name': 'name', 'full_name': 'name',
    'leadname': 'name', 'lead name': 'name', 'customer': 'name', 'customer name': 'name', 'client': 'name',
    'phone': 'phone', 'Phone': 'phone', 'PHONE': 'phone', 'phonenumber': 'phone', 'phone number': 'phone',
    'mobile': 'phone', 'Mobile': 'phone', 'MOBILE': 'phone', 'mobilenumber': 'phone', 'mobile number': 'phone',
    'contact': 'phone', 'contact number': 'phone', 'tel': 'phone', 'telephone': 'phone',
    'status': 'status', 'Status': 'status', 'STATUS': 'status', 'leadstatus': 'status', 'lead status': 'status',
    'state': 'status', 'stage': 'status',
    'date': 'date_added', 'Date': 'date_added', 'DATE': 'date_added', 'dateadded': 'date_added',
    'date added': 'date_added', 'date_added': 'date_added', 'createdon': 'date_added', 'created on': 'date_added',
    'createdat': 'date_added', 'created at': 'date_added', 'created_at': 'date_added',
    'createddate': 'date_added', 'created date': 'date_added', 'enquirydate': 'date_added', 'enquiry date': 'date_added',
    'age': 'age', 'Age': 'age', 'AGE': 'age', 'years': 'age',
    'gender': 'gender', 'Gender': 'gender', 'GENDER': 'gender', 'sex': 'gender', 'Sex': 'gender',
    'source': 'source', 'Source': 'source', 'SOURCE': 'source', 'leadsource': 'source', 'lead source': 'source',
    'origin': 'source', 'channel': 'source', 'referral': 'source', 'referralsource': 'source', 'referral source': 'source',
    'inquiry': 'inquiry', 'Inquiry': 'inquiry', 'enquiry': 'inquiry', 'Enquiry': 'inquiry', 'query': 'inquiry',
    'interestedin': 'inquiry', 'interested in': 'inquiry', 'service': 'inquiry', 'requirement': 'inquiry',
    'problem': 'problem', 'Problem': 'problem', 'PROBLEM': 'problem', 'issue': 'problem', 'Issue': 'problem',
    'concern': 'problem', 'complaint': 'problem', 'condition': 'problem', 'medicalcondition': 'problem',
    'medical condition': 'problem', 'diagnosis': 'problem', 'symptoms': 'problem', 'healthissue': 'problem',
    'health issue': 'problem', 'notes': 'problem', 'Notes': 'problem', 'remarks': 'problem', 'description': 'problem',
    'presenting problem': 'problem', 'chief complaint': 'problem',
    'treatmentdoctor': 'treatment_doctor', 'treatment doctor': 'treatment_doctor', 'treatment_doctor': 'treatment_doctor',
    'doctor': 'treatment_doctor', 'Doctor': 'treatment_doctor', 'doctorname': 'treatment_doctor', 'doctor name': 'treatment_doctor',
    'assigneddoctor': 'treatment_doctor', 'assigned doctor': 'treatment_doctor', 'physician': 'treatment_doctor',
    'consultant': 'treatment_doctor', 'camp doctor': 'treatment_doctor',
    'treatmentsuggested': 'treatment_suggested', 'treatment suggested': 'treatment_suggested', 'treatment_suggested': 'treatment_suggested',
    'treatment': 'treatment_suggested', 'Treatment': 'treatment_suggested', 'treatmentplan': 'treatment_suggested',
    'treatment plan': 'treatment_suggested', 'suggestedtreatment': 'treatment_suggested', 'procedure': 'treatment_suggested',
    'assignedtouserid': 'assigned_to_user_id', 'assigned to user id': 'assigned_to_user_id', 'assigned_to_user_id': 'assigned_to_user_id',
    'assignedto': 'assigned_to_user_id', 'assigned to': 'assigned_to_user_id', 'assignee': 'assigned_to_user_id',
    'owner': 'assigned_to_user_id', 'salesperson': 'assigned_to_user_id', 'handler': 'assigned_to_user_id',
    'guardianname': 'guardian_name', 'guardian name': 'guardian_name', 'husbandname': 'guardian_name', 'husband name': 'guardian_name',
    'husband/guardian name': 'guardian_name', 'husband_or_guardian_name': 'guardian_name',
    'guardianage': 'guardian_age', 'guardian age': 'guardian_age', 'husbandage': 'guardian_age', 'husband age': 'guardian_age',
    'location': 'location', 'Location': 'location', 'LOCATION': 'location', 'city': 'location', 'City': 'location', 'address': 'location',
    'alternatephone': 'alternate_phone', 'alternate phone': 'alternate_phone', 'altphone': 'alternate_phone',
    'alternative phone number': 'alternate_phone', 'alternative_phone_number': 'alternate_phone',
    'referralrequired': 'referral_required', 'referral required': 'referral_required',
};

export function normalizeLead(lead: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};

    for (const [key, value] of Object.entries(lead)) {
        let mappedField = COLUMN_MAPPINGS[key];
        if (!mappedField) {
            const lowerKey = key.toLowerCase().trim();
            mappedField = COLUMN_MAPPINGS[lowerKey];
        }
        if (mappedField) {
            if (normalized[mappedField] === undefined) normalized[mappedField] = value;
        } else {
            const lowerKey = key.toLowerCase().trim();
            if (normalized[lowerKey] === undefined) normalized[lowerKey] = value;
        }
    }

    // Smart detection: swap source/status if mismatched
    const sourceVal = normalized.source;
    const statusVal = normalized.status;
    if (looksLikeStatus(sourceVal) && looksLikeSource(statusVal)) {
        normalized.source = statusVal;
        normalized.status = sourceVal;
    } else if (looksLikeStatus(sourceVal) && !statusVal) {
        normalized.status = sourceVal;
        normalized.source = undefined;
    } else if (looksLikeStatus(sourceVal)) {
        normalized.source = undefined;
    }

    return normalized;
}
