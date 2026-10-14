$ErrorActionPreference = "Stop"

# 1. Create test file
"This is a test document for MindAI. It contains sample text to verify that document upload and processing work correctly." | Out-File -Encoding utf8 test_doc.txt
Write-Host "Created test_doc.txt"

# 2. Upload File (the API has no authentication)
Add-Type -AssemblyName 'System.Net.Http'
$client = New-Object System.Net.Http.HttpClient

$content = New-Object System.Net.Http.MultipartFormDataContent
$filePath = Join-Path $PWD "test_doc.txt"
$fileStream = [System.IO.File]::OpenRead($filePath)
$fileContent = New-Object System.Net.Http.StreamContent($fileStream)
$fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("text/plain")
$content.Add($fileContent, "file", "test_doc.txt")

$uploadUrl = "http://localhost:8000/api/documents/upload"
try {
    $response = $client.PostAsync($uploadUrl, $content).Result

    if ($response.IsSuccessStatusCode) {
        Write-Host "File uploaded successfully"
        $responseBody = $response.Content.ReadAsStringAsync().Result
        Write-Host $responseBody
    } else {
        Write-Host "Upload failed: $($response.StatusCode)"
        $responseBody = $response.Content.ReadAsStringAsync().Result
        Write-Host $responseBody
        exit 1
    }
} finally {
    $fileStream.Dispose()
    $client.Dispose()
}
