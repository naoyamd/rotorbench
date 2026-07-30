import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function schemaIssues(validator, value, prefix = "") {
  if (validator(value)) return [];
  return (validator.errors ?? []).map((error) => {
    const instancePath = error.instancePath
      ? error.instancePath.slice(1).replaceAll("/", ".")
      : "";
    const missing = error.keyword === "required"
      ? error.params.missingProperty
      : "";
    const property = [prefix, instancePath, missing].filter(Boolean).join(".");
    return {
      code: `schema-${error.keyword}`,
      message: `${property || "manifest"} ${error.message ?? "is invalid"}`,
      ...(property ? { path: property } : {}),
    };
  });
}

async function readSchema(snapshotRoot, name) {
  return JSON.parse(await readFile(
    path.join(snapshotRoot, "schemas", name),
    "utf8",
  ));
}

export async function loadFrozenContractValidators(
  snapshotRoot,
  { runSchemaPath, assessmentSchemaPath } = {},
) {
  const [artifact, v4Contract, plan, workRecord, submission, sanitizationReport, reviewPackage, reviewSubmission, reviewRecord] = await Promise.all([
    readSchema(snapshotRoot, "artifact.schema.json"),
    readSchema(snapshotRoot, "stage-contract-v4.schema.json"),
    readSchema(snapshotRoot, "plan.schema.json"),
    readSchema(snapshotRoot, "work-record.schema.json"),
    readSchema(snapshotRoot, "submission.schema.json"),
    readSchema(snapshotRoot, "sanitization-report.schema.json"),
    readSchema(snapshotRoot, "review-package.schema.json"),
    readSchema(snapshotRoot, "review-submission.schema.json"),
    readSchema(snapshotRoot, "review-record.schema.json"),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const schema of [artifact, v4Contract, plan, workRecord, submission, sanitizationReport, reviewPackage, reviewSubmission, reviewRecord]) {
    ajv.addSchema(schema);
  }
  let run = null;
  if (runSchemaPath) {
    run = JSON.parse(await readFile(runSchemaPath, "utf8"));
    ajv.addSchema(run);
  }
  let assessment = null;
  if (assessmentSchemaPath) {
    assessment = JSON.parse(await readFile(assessmentSchemaPath, "utf8"));
    ajv.addSchema(assessment);
  }
  const get = (schema, label) => {
    const validator = ajv.getSchema(schema.$id);
    if (typeof validator !== "function") {
      throw new Error(`Frozen execution contract cannot compile ${label}`);
    }
    return validator;
  };
  const artifactValidator = get(artifact, "artifact schema");
  const planValidator = get(plan, "plan schema");
  const workRecordValidator = get(workRecord, "work-record schema");
  const submissionValidator = get(submission, "submission schema");
  const sanitizationReportValidator = get(sanitizationReport, "sanitization report schema");
  const reviewPackageValidator = get(reviewPackage, "review package schema");
  const reviewSubmissionValidator = get(reviewSubmission, "review submission schema");
  const reviewRecordValidator = get(reviewRecord, "review record schema");
  const checkpointReceiptRecordValidator = ajv.getSchema(
    `${v4Contract.$id}#/$defs/checkpointReceiptRecord`,
  );
  if (typeof checkpointReceiptRecordValidator !== "function") {
    throw new Error("Frozen execution contract cannot compile checkpoint receipt record schema");
  }
  const runValidator = run ? get(run, "run schema") : null;
  const assessmentValidator = assessment ? get(assessment, "assessment schema") : null;
  const validateRun = (value) => {
    const issues = schemaIssues(runValidator, value);
    if (Array.isArray(value?.artifacts)) {
      const ids = new Set();
      value.artifacts.forEach((artifactValue, index) => {
        if (ids.has(artifactValue?.id)) {
          issues.push({
            code: "duplicate-artifact-id",
            message: `artifacts.${index}.id is duplicated`,
            path: `artifacts.${index}.id`,
          });
        }
        ids.add(artifactValue?.id);
      });
    }
    return issues;
  };
  return {
    validateArtifact: (value, index = 0) =>
      schemaIssues(artifactValidator, value, `artifacts.${index}`),
    validatePlan: (value) => schemaIssues(planValidator, value),
    validateWorkRecord: (value) => schemaIssues(workRecordValidator, value),
    validateSubmission: (value) => schemaIssues(submissionValidator, value),
    validateCheckpointReceiptRecord: (value) =>
      schemaIssues(checkpointReceiptRecordValidator, value),
    validateSanitizationReport: (value) => schemaIssues(sanitizationReportValidator, value),
    validateReviewPackage: (value) => schemaIssues(reviewPackageValidator, value),
    validateReviewSubmission: (value) => schemaIssues(reviewSubmissionValidator, value),
    validateReviewRecord: (value) => schemaIssues(reviewRecordValidator, value),
    ...(assessmentValidator
      ? { validateAssessment: (value) => schemaIssues(assessmentValidator, value) }
      : {}),
    ...(runValidator
      ? { validateRun }
      : {}),
  };
}
