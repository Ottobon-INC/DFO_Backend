import { IsOptional, IsString, IsArray, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class IvfFemaleProfileDto {
    @IsOptional() @IsString() education?: string;
    @IsOptional() @IsString() occupation?: string;
    @IsOptional() @IsString() marital_life_years?: string;
    @IsOptional() @IsString() age_of_menarche?: string;
    @IsOptional() @IsString() periods?: string;
    @IsOptional() @IsString() lmp?: string;
    @IsOptional() @IsString() flow?: string;
    @IsOptional() @IsString() dysmenorrhoea?: string;
    @IsOptional() @IsString() premenstrual_spotting?: string;
    @IsOptional() @IsString() intermenstrual_bleeding?: string;
    @IsOptional() @IsString() bowels?: string;
    @IsOptional() @IsString() consanguinity?: string;
    @IsOptional() @IsString() weight_gain?: string;
    @IsOptional() @IsString() freq_of_ic?: string;
    @IsOptional() @IsString() dyspareunia?: string;
    @IsOptional() @IsString() loss_of_libido?: string;
    @IsOptional() @IsArray() obstetric_history?: any[];
    @IsOptional() @IsString() past_medical?: string;
    @IsOptional() @IsString() drug_allergy?: string;
    @IsOptional() @IsString() family_history?: string;
    @IsOptional() @IsString() surgical_history?: string;
    @IsOptional() @IsString() treatment_history?: string;
    @IsOptional() @IsString() prev_ivf_details?: string;
    @IsOptional() @IsString() exam_date?: string;
    @IsOptional() @IsString() exam_ht?: string;
    @IsOptional() @IsString() exam_wt?: string;
    @IsOptional() @IsString() exam_bmi?: string;
    @IsOptional() @IsString() exam_bp?: string;
    @IsOptional() @IsString() acne?: string;
    @IsOptional() @IsString() hirsutism?: string;
    @IsOptional() @IsString() acanthosis?: string;
    @IsOptional() @IsString() breasts?: string;
    @IsOptional() @IsString() galactorrhoea?: string;
    @IsOptional() @IsString() fg_score?: string;
}

export class IvfProceduresDto {
    @IsOptional() @IsArray() hsg_rows?: any[];
    @IsOptional() @IsArray() hysteroscopy_rows?: any[];
    @IsOptional() @IsArray() laparoscopy_rows?: any[];
}

export class IvfLabPanelsDto {
    @IsOptional() @IsString() panel_type?: 'FEMALE' | 'MALE';
    @IsOptional() @IsArray() dates?: any[];
    @IsOptional() @IsArray() lab_rows?: any[];
    @IsOptional() @IsString() antithyroid_antibodies?: string;
    @IsOptional() @IsString() antimicrosomial_antibodies?: string;
}

export class IvfBaselineUsgDto {
    @IsOptional() @IsString() usg_date?: string;
    @IsOptional() @IsString() day_of_mc?: string;
    @IsOptional() @IsString() uterus_type?: string;
    @IsOptional() @IsString() uterus_size?: string;
    @IsOptional() @IsString() uterus_vol?: string;
    @IsOptional() @IsString() emzj?: string;
    @IsOptional() @IsString() usg_3d_4d?: string;
    @IsOptional() @IsString() rt_ut_ri?: string;
    @IsOptional() @IsString() rt_ut_pi?: string;
    @IsOptional() @IsString() rt_ut_comment?: string;
    @IsOptional() @IsString() lt_ut_ri?: string;
    @IsOptional() @IsString() lt_ut_pi?: string;
    @IsOptional() @IsString() lt_ut_comment?: string;
    @IsOptional() @IsString() rt_ovary_size?: string;
    @IsOptional() @IsString() rt_ovary_vol?: string;
    @IsOptional() @IsString() rt_ovary_access?: string;
    @IsOptional() @IsString() rt_ovary_paf?: string;
    @IsOptional() @IsString() rt_ovary_comment?: string;
    @IsOptional() @IsString() lt_ovary_size?: string;
    @IsOptional() @IsString() lt_ovary_vol?: string;
    @IsOptional() @IsString() lt_ovary_access?: string;
    @IsOptional() @IsString() lt_ovary_paf?: string;
    @IsOptional() @IsString() lt_ovary_comment?: string;
}

export class IvfMaleProfileDto {
    @IsOptional() @IsString() name?: string;
    @IsOptional() @IsString() age?: string;
    @IsOptional() @IsString() height?: string;
    @IsOptional() @IsString() weight?: string;
    @IsOptional() @IsString() bmi?: string;
    @IsOptional() @IsString() occupation?: string;
    @IsOptional() @IsString() smoking?: string;
    @IsOptional() @IsString() alcohol?: string;
    @IsOptional() @IsString() pan_parag?: string;
    @IsOptional() @IsString() retrograde_ejaculation?: string;
    @IsOptional() @IsString() premature_ejaculation?: string;
    @IsOptional() @IsString() erectile_dysfunction?: string;
    @IsOptional() @IsString() loss_of_libido?: string;
    @IsOptional() @IsString() medical_history?: string;
    @IsOptional() @IsString() surgical_history?: string;
    @IsOptional() @IsString() treatment_history?: string;
    @IsOptional() @IsString() family_ht?: string;
    @IsOptional() @IsString() family_dm?: string;
    @IsOptional() @IsString() family_hypothyroid?: string;
    @IsOptional() @IsString() urologist_opinion?: string;
}

export class IvfSemenAnalysisDto {
    @IsOptional() @IsString() semen_count?: string;
    @IsOptional() @IsString() progressive_a_pct?: string;
    @IsOptional() @IsString() progressive_a_conc?: string;
    @IsOptional() @IsString() sluggish_b_pct?: string;
    @IsOptional() @IsString() sluggish_b_conc?: string;
    @IsOptional() @IsString() non_progressive_c_pct?: string;
    @IsOptional() @IsString() non_progressive_c_conc?: string;
    @IsOptional() @IsString() static_d_pct?: string;
    @IsOptional() @IsString() static_d_conc?: string;
    @IsOptional() @IsString() type_ab_pct?: string;
    @IsOptional() @IsString() type_ab_conc?: string;
    @IsOptional() @IsString() morph_normal_pct?: string;
    @IsOptional() @IsString() morph_normal_conc?: string;
    @IsOptional() @IsString() morph_abnormal_pct?: string;
    @IsOptional() @IsString() morph_abnormal_conc?: string;
    @IsOptional() @IsString() morph_head_pct?: string;
    @IsOptional() @IsString() morph_head_conc?: string;
    @IsOptional() @IsString() morph_mid_pct?: string;
    @IsOptional() @IsString() morph_mid_conc?: string;
    @IsOptional() @IsString() morph_tail_pct?: string;
    @IsOptional() @IsString() morph_tail_conc?: string;
    @IsOptional() @IsString() terato_index_pct?: string;
    @IsOptional() @IsString() terato_index_conc?: string;
    @IsOptional() @IsString() fragmented?: string;
    @IsOptional() @IsString() non_fragmented?: string;
    @IsOptional() @IsString() dfi_value?: string;
    @IsOptional() @IsString() dna_impression?: string;
    @IsOptional() @IsString() male_usg_date?: string;
    @IsOptional() @IsString() testicular_biopsy_date?: string;
    @IsOptional() @IsArray() semen_comparison_rows?: any[];
}

export class IvfTreatmentTrackingDto {
    @IsOptional() @IsString() tubal_factor?: string;
    @IsOptional() @IsString() ovarian_factor?: string;
    @IsOptional() @IsString() uterine_factor?: string;
    @IsOptional() @IsString() unexplained_infertility?: string;
    @IsOptional() @IsString() hormones_comment?: string;
    @IsOptional() @IsString() sa_casa_comments?: string;
    @IsOptional() @IsString() dna_frag_summary?: string;
    @IsOptional() @IsString() medical_disorder?: string;
    @IsOptional() @IsArray() protocol_steps?: any[];
    @IsOptional() @IsString() counselling_date?: string;
    @IsOptional() @IsBoolean() cost_explained?: boolean;
    @IsOptional() @IsBoolean() risk_explained?: boolean;
    @IsOptional() @IsBoolean() success_rate_explained?: boolean;
    @IsOptional() @IsString() fm_date?: string;
    @IsOptional() @IsString() fm_wt?: string;
    @IsOptional() @IsString() fm_bmi?: string;
    @IsOptional() @IsString() fm_diagnosis?: string;
    @IsOptional() @IsString() fm_protocol?: string;
    @IsOptional() @IsArray() follicular_rows?: any[];
}

export class SaveIvfCaseSheetDto {
    @IsOptional()
    @ValidateNested()
    @Type(() => IvfFemaleProfileDto)
    femaleProfile?: IvfFemaleProfileDto;

    @IsOptional()
    @ValidateNested()
    @Type(() => IvfProceduresDto)
    procedures?: IvfProceduresDto;

    @IsOptional()
    @ValidateNested()
    @Type(() => IvfLabPanelsDto)
    femaleLabPanels?: IvfLabPanelsDto;

    @IsOptional()
    @ValidateNested()
    @Type(() => IvfLabPanelsDto)
    maleLabPanels?: IvfLabPanelsDto;

    @IsOptional()
    @ValidateNested()
    @Type(() => IvfBaselineUsgDto)
    baselineUsg?: IvfBaselineUsgDto;

    @IsOptional()
    @ValidateNested()
    @Type(() => IvfMaleProfileDto)
    maleProfile?: IvfMaleProfileDto;

    @IsOptional()
    @ValidateNested()
    @Type(() => IvfSemenAnalysisDto)
    semenAnalysis?: IvfSemenAnalysisDto;

    @IsOptional()
    @ValidateNested()
    @Type(() => IvfTreatmentTrackingDto)
    treatmentTracking?: IvfTreatmentTrackingDto;
}
