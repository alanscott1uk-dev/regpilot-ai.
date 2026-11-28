"""Check the public MyCSF transport schema. This never contacts a subscriber or assessment."""
import argparse
import json
from pathlib import Path
from urllib.request import urlopen

SPEC = 'https://api.mycsf.net/docs/OpenAPI/v1'
OPERATIONS = {
    '/v1/subscribers/{subscriberId}/assessments': ('get', 'Administration_GetAssessments'),
    '/v1/assessmentdetailed/{assessmentId}': ('get', 'Assessment_GetDetailedAssessment'),
    '/v1/assessment/{assessmentId}/documents/{documentTypeId}': ('get', 'Document_GetDocuments'),
    '/v1/assessment/{assessmentId}/document': ('post', 'Document_UploadDocument'),
    '/v1/documents/{documentId}/download/{attachmentId}': ('get', 'Document_Download'),
    '/v1/assessment/{assessmentId}/requirement/{requirementId}/document/{documentId}': ('put', 'Document_LinkDocument'),
}

def verify(spec):
    assert spec['host'] == 'api.mycsf.net' and 'https' in spec['schemes']
    for path, (method, operation) in OPERATIONS.items():
        assert spec['paths'][path][method]['operationId'] == operation, path
    models = spec['definitions']
    required = {
        'DetailedAssessmentModel': {'BUID', 'OBJ ID', 'TYPE', 'STATEMENT', 'DOMAIN', 'CONTROL REFERENCE'},
        'DocumentItem': {'Id', 'CSFAssessmentId', 'DocumentTypeId', 'AttachmentId', 'AttachmentFilename'},
        'DocumentUploadModel': {'DocumentId', 'AssessmentId', 'DocumentName', 'DocumentOverwrite'},
        'DocumentLinkModel': {'Actor', 'MaturityLevels'},
    }
    for model, fields in required.items():
        assert fields <= models[model]['properties'].keys(), model
    print(f'{len(OPERATIONS)} public API operations and {len(required)} models verified')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', type=Path)
    args = parser.parse_args()
    if args.file:
        verify(json.loads(args.file.read_text()))
    else:
        with urlopen(SPEC, timeout=30) as response:
            verify(json.load(response))
