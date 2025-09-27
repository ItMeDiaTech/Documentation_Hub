using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using DocxFormatter.Core.Interfaces;
using DocxFormatter.Core.Models;

namespace DocxFormatter.Core.Services
{
/// <summary>
/// Core service for managing hyperlinks in Word documents.
/// Provides basic hyperlink operations and coordination with specialized services.
/// </summary>
public class HyperlinkService : IHyperlinkService
{
// Regex patterns for identifying theSource URLs that should have ContentId appended
private static readonly Regex ContentIdPattern = new(
@"(TSRC|CMS)-([a-zA-Z0-9]+)-(\d{6})",
RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static readonly Regex DocumentIdPattern = new(
            @"docid=([a-zA-Z0-9-]+)(?:[^a-zA-Z0-9-]|$)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private readonly BackupService _backupService;
        private readonly IHyperlinkApiService _apiService;
        private readonly ChangeHistoryManager _changeHistoryManager;
        private static readonly Serilog.ILogger _logger = Serilog.Log.ForContext<HyperlinkService>();

        public HyperlinkService(
            IHyperlinkApiService apiService,
            ChangeHistoryManager? changeHistoryManager = null)
        {
            _backupService = new BackupService();
            _apiService = apiService ?? throw new ArgumentNullException(nameof(apiService));
            _changeHistoryManager = changeHistoryManager ?? new ChangeHistoryManager();
        }

        // Backward compatibility constructor
        public HyperlinkService(ChangeHistoryManager? changeHistoryManager = null)
        {
            _backupService = new BackupService();
            _apiService = new HyperlinkApiService();
            _changeHistoryManager = changeHistoryManager ?? new ChangeHistoryManager();
        }

        // Nested classes removed - now in separate model files:
        // HyperlinkInfo -> DetailedHyperlinkInfo.cs (internal use)
        // HyperlinkProcessingOptions -> HyperlinkProcessingOptions.cs
        // HyperlinkProcessingResult -> HyperlinkProcessingResult.cs

        /// <summary>
        /// Scans a document for all hyperlinks and returns detailed information.
        /// </summary>
        /// <param name="document">The document to scan</param>
        /// <param name="validateLinks">Whether to validate each hyperlink</param>
        /// <returns>List of detailed hyperlink information</returns>
        public async Task<List<DetailedHyperlinkInfo>> ScanHyperlinksAsync(WordprocessingDocument document, bool validateLinks = false)
        {
            if (document == null)
                throw new ArgumentNullException(nameof(document));

            var hyperlinks = new List<DetailedHyperlinkInfo>();

            await Task.Run(() =>
            {
                // Scan main document
                if (document.MainDocumentPart?.Document?.Body != null)
                {
                    ScanHyperlinksInElement(document.MainDocumentPart.Document.Body,
                        document.MainDocumentPart, hyperlinks, validateLinks);
                }

                // Scan headers
                var headerParts = document.MainDocumentPart?.HeaderParts;
                if (headerParts != null)
                {
                    foreach (var headerPart in headerParts)
                    {
                        ScanHyperlinksInElement(headerPart.Header, headerPart, hyperlinks, validateLinks);
                    }
                }

                // Scan footers
                var footerParts = document.MainDocumentPart?.FooterParts;
                if (footerParts != null)
                {
                    foreach (var footerPart in footerParts)
                    {
                        ScanHyperlinksInElement(footerPart.Footer, footerPart, hyperlinks, validateLinks);
                    }
                }
            });

            return hyperlinks;
        }

        /// <summary>
        /// Fixes source hyperlinks by appending Content IDs and performing updates.
        /// This is the main functionality requested by the user.
        /// </summary>
        /// <param name="filePath">Path to the document to process</param>
        /// <param name="options">Processing options</param>
        /// <param name="progress">Progress reporting</param>
        /// <returns>Processing result</returns>
        public async Task<HyperlinkProcessingResult> FixSourceHyperlinksAsync(string filePath,
            HyperlinkProcessingOptions? options = null, IProgress<double>? progress = null)
        {
            if (string.IsNullOrWhiteSpace(filePath))
                throw new ArgumentException("File path cannot be null or empty", nameof(filePath));

            if (!File.Exists(filePath))
                throw new FileNotFoundException($"File not found: {filePath}");

            options ??= new HyperlinkProcessingOptions();
            var result = new HyperlinkProcessingResult();
            var startTime = DateTime.Now;

            try
            {
                // Create backup if requested
                if (options.CreateBackup)
                {
                    progress?.Report(5);
                    result.BackupPath = _backupService.CreateBackupWithCleanup(filePath);
                }

                progress?.Report(10);

                using var document = WordprocessingDocument.Open(filePath, true);

                // Use internal advanced fixing functionality
                var fixingOptions = ConvertToFixingOptions(options);
                var fixingResult = await PerformAdvancedHyperlinkFixingAsync(document, fixingOptions);

                progress?.Report(90);

                // Convert result back to original format for compatibility
                var convertedResult = ConvertFixingResult(fixingResult, result.BackupPath);

                // Track the operation for undo/redo if successful
                if (convertedResult.Success && convertedResult.ProcessedHyperlinks > 0)
                {
                    var operation = new HyperlinkProcessingOperation
                    {
                        DocumentPath = filePath,
                        Description = $"Fixed {convertedResult.ProcessedHyperlinks} hyperlinks in {Path.GetFileName(filePath)}",
                        OperationType = "HyperlinkFix",
                        BackupPath = result.BackupPath,
                        Options = fixingOptions
                    };

                    // Track changes made
                    foreach (var hyperlink in convertedResult.ProcessedLinks)
                    {
                        operation.Changes.Add(new HyperlinkChange
                        {
                            HyperlinkId = hyperlink.Id,
                            OriginalUrl = hyperlink.Url,
                            NewUrl = hyperlink.Url,
                            OriginalDisplayText = hyperlink.DisplayText,
                            NewDisplayText = hyperlink.DisplayText,
                            Type = HyperlinkChangeType.BothChanged
                        });
                    }

                    // Add to history
                    _changeHistoryManager.AddOperation(operation);
                }

                progress?.Report(100);

                return convertedResult;
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.ErrorMessages.Add($"Fatal error: {ex.Message}");
                result.Duration = DateTime.Now - startTime;
                return result;
            }
        }

        /// <summary>
        /// Fixes source hyperlinks using the new HyperlinkFixingOptions.
        /// This overload provides access to the enhanced fixing functionality.
        /// </summary>
        /// <param name="filePath">Path to the document to process</param>
        /// <param name="fixingOptions">Advanced fixing options</param>
        /// <param name="progress">Progress reporting</param>
        /// <returns>Processing result</returns>
        public async Task<HyperlinkProcessingResult> FixSourceHyperlinksAsync(string filePath,
            HyperlinkFixingOptions? fixingOptions = null, IProgress<double>? progress = null)
        {
            if (string.IsNullOrWhiteSpace(filePath))
                throw new ArgumentException("File path cannot be null or empty", nameof(filePath));

            if (!File.Exists(filePath))
                throw new FileNotFoundException($"File not found: {filePath}");

            fixingOptions ??= new HyperlinkFixingOptions();
            var startTime = DateTime.Now;
            var backupPath = string.Empty;

            try
            {
                // Create backup if requested
                if (fixingOptions.CreateBackup)
                {
                    progress?.Report(5);
                    backupPath = _backupService.CreateBackupWithCleanup(filePath);
                }

                progress?.Report(10);

                using var document = WordprocessingDocument.Open(filePath, true);

                // Use internal advanced fixing functionality
                var fixingResult = await PerformAdvancedHyperlinkFixingAsync(document, fixingOptions);

                progress?.Report(90);

                // Convert result to original format for compatibility
                var result = ConvertFixingResult(fixingResult, backupPath);

                // Track the operation for undo/redo if successful
                if (result.Success && result.ProcessedHyperlinks > 0)
                {
                    var operation = new HyperlinkProcessingOperation
                    {
                        DocumentPath = filePath,
                        Description = $"Fixed {result.ProcessedHyperlinks} hyperlinks in {Path.GetFileName(filePath)}",
                        OperationType = "HyperlinkFix",
                        BackupPath = backupPath,
                        Options = fixingOptions ?? new HyperlinkFixingOptions()
                    };

                    // Track changes made
                    foreach (var hyperlink in result.ProcessedLinks)
                    {
                        operation.Changes.Add(new HyperlinkChange
                        {
                            HyperlinkId = hyperlink.Id,
                            OriginalUrl = hyperlink.Url, // This would need to be tracked better in a real implementation
                            NewUrl = hyperlink.Url,
                            OriginalDisplayText = hyperlink.DisplayText,
                            NewDisplayText = hyperlink.DisplayText,
                            Type = HyperlinkChangeType.BothChanged
                        });
                    }

                    // Add to history
                    _changeHistoryManager.AddOperation(operation);
                }

                progress?.Report(100);

                return result;
            }
            catch (Exception ex)
            {
                var result = new HyperlinkProcessingResult
                {
                    Success = false,
                    BackupPath = backupPath,
                    Duration = DateTime.Now - startTime
                };
                result.ErrorMessages.Add($"Fatal error: {ex.Message}");
                return result;
            }
        }

        /// <summary>
        /// Validates hyperlinks in a document and reports issues.
        /// </summary>
        /// <param name="document">The document to validate</param>
        /// <returns>List of validation issues</returns>
        public async Task<List<DetailedHyperlinkInfo>> ValidateHyperlinksAsync(WordprocessingDocument document)
        {
            var hyperlinks = await ScanHyperlinksAsync(document, true);
            return hyperlinks.Where(h => !h.IsValid).ToList();
        }

        /// <summary>
        /// Appends Content ID to hyperlinks that match specific criteria.
        /// </summary>
        /// <param name="document">The document to process</param>
        /// <param name="contentId">The Content ID to append (e.g., "#content")</param>
        /// <param name="urlPattern">Pattern to match URLs (optional)</param>
        /// <returns>Number of hyperlinks updated</returns>
        public async Task<int> AppendContentIdToHyperlinksAsync(WordprocessingDocument document,
            string contentId, string? urlPattern = null)
        {
            if (document == null)
                throw new ArgumentNullException(nameof(document));

            if (string.IsNullOrWhiteSpace(contentId))
                throw new ArgumentException("Content ID cannot be null or empty", nameof(contentId));

            var updateCount = 0;
            var urlRegex = !string.IsNullOrWhiteSpace(urlPattern)
                ? new Regex(urlPattern, RegexOptions.IgnoreCase)
                : null;

            await Task.Run(() =>
            {
                // Process main document
                if (document.MainDocumentPart?.Document?.Body != null)
                {
                    updateCount += AppendContentIdInElement(document.MainDocumentPart.Document.Body,
                        document.MainDocumentPart, contentId, urlRegex);
                }

                // Process headers
                var headerParts = document.MainDocumentPart?.HeaderParts;
                if (headerParts != null)
                {
                    foreach (var headerPart in headerParts)
                    {
                        updateCount += AppendContentIdInElement(headerPart.Header, headerPart, contentId, urlRegex);
                    }
                }

                // Process footers
                var footerParts = document.MainDocumentPart?.FooterParts;
                if (footerParts != null)
                {
                    foreach (var footerPart in footerParts)
                    {
                        updateCount += AppendContentIdInElement(footerPart.Footer, footerPart, contentId, urlRegex);
                    }
                }
            });

            return updateCount;
        }

        /// <summary>
        /// Creates a batch operation for hyperlink processing.
        /// </summary>
        /// <param name="filePaths">Files to process</param>
        /// <param name="options">Processing options</param>
        /// <returns>Batch operation</returns>
        public IBatchOperation CreateBatchOperation(List<string> filePaths, HyperlinkProcessingOptions options)
        {
            return new HyperlinkBatchOperation(this, filePaths, options);
        }

        /// <summary>
        /// Creates a batch operation for hyperlink processing with advanced options.
        /// </summary>
        /// <param name="filePaths">Files to process</param>
        /// <param name="fixingOptions">Advanced fixing options</param>
        /// <returns>Batch operation</returns>
        public IBatchOperation CreateBatchOperation(List<string> filePaths, HyperlinkFixingOptions fixingOptions)
        {
            return new HyperlinkBatchOperation(this, filePaths, fixingOptions);
        }

        /// <summary>
        /// Processes multiple documents for hyperlink fixes.
        /// </summary>
        /// <param name="filePaths">Files to process</param>
        /// <param name="options">Processing options</param>
        /// <param name="progress">Progress reporting</param>
        /// <param name="cancellationToken">Cancellation token</param>
        /// <returns>List of processing results</returns>
        public async Task<List<HyperlinkProcessingResult>> ProcessDocumentsAsync(
            List<string> filePaths,
            HyperlinkProcessingOptions options,
            IProgress<double>? progress = null,
            CancellationToken cancellationToken = default)
        {
            var results = new List<HyperlinkProcessingResult>();
            var totalFiles = filePaths.Count;
            var processedFiles = 0;

            foreach (var filePath in filePaths)
            {
                if (cancellationToken.IsCancellationRequested)
                    break;

                try
                {
                    var fileProgress = new Progress<double>(p =>
                    {
                        var overallProgress = (processedFiles * 100.0 + p) / totalFiles;
                        progress?.Report(overallProgress);
                    });

                    var result = await FixSourceHyperlinksAsync(filePath, options, fileProgress);
                    results.Add(result);
                }
                catch (Exception ex)
                {
                    _logger.Error(ex, "Error processing file {FilePath} in batch operation", filePath);
                    results.Add(new HyperlinkProcessingResult
                    {
                        Success = false,
                        ErrorMessages = new List<string> { $"Error processing {filePath}: {ex.Message}" }
                    });
                }

                processedFiles++;
                progress?.Report((processedFiles * 100.0) / totalFiles);
            }

            return results;
        }

        /// <summary>
        /// Processes multiple documents for hyperlink fixes with advanced options.
        /// </summary>
        /// <param name="filePaths">Files to process</param>
        /// <param name="fixingOptions">Advanced fixing options</param>
        /// <param name="progress">Progress reporting</param>
        /// <param name="cancellationToken">Cancellation token</param>
        /// <returns>List of processing results</returns>
        public async Task<List<HyperlinkProcessingResult>> ProcessDocumentsAsync(
            List<string> filePaths,
            HyperlinkFixingOptions fixingOptions,
            IProgress<double>? progress = null,
            CancellationToken cancellationToken = default)
        {
            var results = new List<HyperlinkProcessingResult>();
            var totalFiles = filePaths.Count;
            var processedFiles = 0;

            foreach (var filePath in filePaths)
            {
                if (cancellationToken.IsCancellationRequested)
                    break;

                try
                {
                    var fileProgress = new Progress<double>(p =>
                    {
                        var overallProgress = (processedFiles * 100.0 + p) / totalFiles;
                        progress?.Report(overallProgress);
                    });

                    var result = await FixSourceHyperlinksAsync(filePath, fixingOptions, fileProgress);
                    results.Add(result);
                }
                catch (Exception ex)
                {
                    _logger.Error(ex, "Error processing file {FilePath} in batch operation", filePath);
                    results.Add(new HyperlinkProcessingResult
                    {
                        Success = false,
                        ErrorMessages = new List<string> { $"Error processing {filePath}: {ex.Message}" }
                    });
                }

                processedFiles++;
                progress?.Report((processedFiles * 100.0) / totalFiles);
            }

            return results;
        }

        #region Helper Methods

        /// <summary>
        /// Converts HyperlinkFixingResult to HyperlinkProcessingResult for compatibility.
        /// </summary>
        /// <param name="fixingResult">The fixing result to convert</param>
        /// <param name="backupPath">The backup path to include</param>
        /// <returns>Converted processing result</returns>
        private HyperlinkProcessingResult ConvertFixingResult(HyperlinkFixingResult fixingResult, string backupPath = "")
        {
            var result = new HyperlinkProcessingResult
            {
                Success = fixingResult.Success,
                TotalHyperlinks = fixingResult.TotalHyperlinks,
                ProcessedHyperlinks = fixingResult.ProcessedHyperlinks,
                SkippedHyperlinks = Math.Max(0, fixingResult.TotalHyperlinks - fixingResult.ProcessedHyperlinks),
                ErrorCount = fixingResult.ErrorMessages.Count,
                ErrorMessages = new List<string>(fixingResult.ErrorMessages),
                BackupPath = backupPath,
                Duration = fixingResult.Duration
            };

            // For compatibility, treat updated URLs as processed hyperlinks
            if (fixingResult.UpdatedUrls > 0 || fixingResult.UpdatedDisplayTexts > 0)
            {
                result.ProcessedHyperlinks = Math.Max(result.ProcessedHyperlinks,
                    fixingResult.UpdatedUrls + fixingResult.UpdatedDisplayTexts);
            }

            return result;
        }

        /// <summary>
        /// Converts HyperlinkProcessingOptions to HyperlinkFixingOptions.
        /// </summary>
        /// <param name="processingOptions">The processing options to convert</param>
        /// <returns>Converted fixing options</returns>
        private HyperlinkFixingOptions ConvertToFixingOptions(HyperlinkProcessingOptions processingOptions)
        {
            var fixingOptions = new HyperlinkFixingOptions
            {
                CreateBackup = processingOptions.CreateBackup,
                UpdateTitles = false, // Default to false for backward compatibility
                AppendContentId = !string.IsNullOrEmpty(processingOptions.ContentIdToAppend),
                PowerAutomateUrl = GetPowerAutomateUrlFromSettings()
            };

            return fixingOptions;
        }

        #endregion

        #region Private Methods

        // Validation methods moved to HyperlinkValidationService

        private bool ShouldProcessHyperlink(DetailedHyperlinkInfo hyperlink, HyperlinkProcessingOptions options)
        {
            if (!options.ProcessInternalLinks && hyperlink.IsInternal)
                return false;

            if (!options.ProcessExternalLinks && !hyperlink.IsInternal)
                return false;

            if (!string.IsNullOrEmpty(options.UrlPattern))
            {
                var urlRegex = new Regex(options.UrlPattern, RegexOptions.IgnoreCase);
                if (!urlRegex.IsMatch(hyperlink.Url))
                    return false;
            }

            if (!string.IsNullOrEmpty(options.DisplayTextPattern))
            {
                var displayRegex = new Regex(options.DisplayTextPattern, RegexOptions.IgnoreCase);
                if (!displayRegex.IsMatch(hyperlink.DisplayText))
                    return false;
            }

            return true;
        }

        private async Task<bool> ProcessSingleHyperlinkAsync(DetailedHyperlinkInfo hyperlink, HyperlinkProcessingOptions options)
        {
            return await Task.Run(() =>
            {
                try
                {
                    bool wasModified = false;

                    // Append Content ID only to theSource hyperlinks with matching patterns
                    if (!string.IsNullOrEmpty(options.ContentIdToAppend) && !hyperlink.IsInternal)
                    {
                        // Check if this is a theSource URL with ContentId or DocumentId pattern
                        if (hyperlink.Url.Contains("thesource", StringComparison.OrdinalIgnoreCase) &&
                            (ContentIdPattern.IsMatch(hyperlink.Url) || DocumentIdPattern.IsMatch(hyperlink.Url)))
                        {
                            if (!hyperlink.Url.Contains(options.ContentIdToAppend))
                            {
                                var newUrl = hyperlink.Url + options.ContentIdToAppend;
                                if (UpdateHyperlinkUrl(hyperlink, newUrl))
                                {
                                    hyperlink.Url = newUrl;
                                    wasModified = true;
                                }
                            }
                        }
                    }

                    return wasModified;
                }
                catch
                {
                    return false;
                }
            });
        }

        private bool UpdateHyperlinkUrl(DetailedHyperlinkInfo hyperlinkInfo, string newUrl)
        {
            try
            {
                var relationshipId = hyperlinkInfo.Id;
                if (string.IsNullOrEmpty(relationshipId))
                    return false;

                var part = hyperlinkInfo.ContainingPart;
                var relationship = part.ExternalRelationships.FirstOrDefault(r => r.Id == relationshipId);
                if (relationship == null)
                    return false;

                // Delete old relationship and create new one
                part.DeleteExternalRelationship(relationship);
                var newRelationship = part.AddExternalRelationship(
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
                    new Uri(newUrl, UriKind.Absolute));

                hyperlinkInfo.Element.Id = newRelationship.Id;
                hyperlinkInfo.Id = newRelationship.Id;

                return true;
            }
            catch
            {
                return false;
            }
        }

        private int AppendContentIdInElement(OpenXmlElement element, OpenXmlPart part, string contentId, Regex? urlRegex)
        {
            int updateCount = 0;
            var hyperlinks = element.Descendants<Hyperlink>().ToList();

            foreach (var hyperlink in hyperlinks)
            {
                try
                {
                    var hyperlinkInfo = CreateDetailedHyperlinkInfo(hyperlink, part);

                    if (hyperlinkInfo.IsInternal || string.IsNullOrEmpty(hyperlinkInfo.Url))
                        continue;

                    if (urlRegex != null && !urlRegex.IsMatch(hyperlinkInfo.Url))
                        continue;

                    // Check if URL is a theSource URL with ContentId or DocumentId pattern
                    if (!hyperlinkInfo.Url.Contains("thesource", StringComparison.OrdinalIgnoreCase) ||
                        (!ContentIdPattern.IsMatch(hyperlinkInfo.Url) && !DocumentIdPattern.IsMatch(hyperlinkInfo.Url)))
                        continue;

                    // Process ALL theSource hyperlinks, even if they already have a content ID
                    // (as the existing one might be incorrect)
                    var newUrl = hyperlinkInfo.Url + contentId;
                    if (UpdateHyperlinkUrl(hyperlinkInfo, newUrl))
                    {
                        updateCount++;
                    }
                }
                catch
                {
                    // Skip this hyperlink on error
                    continue;
                }
            }

            return updateCount;
        }

        private async Task ValidateProcessedHyperlinksAsync(List<DetailedHyperlinkInfo> hyperlinks)
        {
            await Task.Run(() =>
            {
                foreach (var hyperlink in hyperlinks)
                {
                    ValidateHyperlink(hyperlink);
                }
            });
        }

        /// <summary>
        /// Helper method to create detailed hyperlink info for internal processing.
        /// </summary>
        private DetailedHyperlinkInfo CreateDetailedHyperlinkInfo(Hyperlink hyperlink, OpenXmlPart part)
        {
            var info = new DetailedHyperlinkInfo
            {
                Element = hyperlink,
                ContainingPart = part,
                DisplayText = string.Join("", hyperlink.Descendants<Text>().Select(t => t.Text))
            };

            var relationshipId = hyperlink.Id?.Value;
            if (!string.IsNullOrEmpty(relationshipId))
            {
                info.Id = relationshipId;

                try
                {
                    var relationship = part.ExternalRelationships.FirstOrDefault(r => r.Id == relationshipId);
                    if (relationship != null)
                    {
                        info.Url = relationship.Uri?.ToString() ?? string.Empty;
                        info.IsInternal = false;
                    }
                    else
                    {
                        // Check for internal relationships
                        var internalRel = part.HyperlinkRelationships.FirstOrDefault(r => r.Id == relationshipId);
                        if (internalRel != null)
                        {
                            info.Url = internalRel.Uri?.ToString() ?? string.Empty;
                            info.IsInternal = true;
                        }
                    }
                }
                catch (Exception ex)
                {
                    info.IsValid = false;
                    info.ValidationMessage = "Unable to resolve hyperlink relationship";
                    _logger.Warning(ex, "Error resolving hyperlink relationship {RelationshipId}", relationshipId);
                }
            }

            // Get context
            var paragraph = hyperlink.Ancestors<Paragraph>().FirstOrDefault();
            if (paragraph != null)
            {
                var paragraphText = string.Join("", paragraph.Descendants<Text>().Select(t => t.Text));
                info.Context = paragraphText.Length > 100 ? paragraphText.Substring(0, 100) + "..." : paragraphText;
            }

            return info;
        }

        /// <summary>
        /// Retrieves the PowerAutomate URL from user settings with fallback to default.
        /// </summary>
        /// <returns>The configured PowerAutomate URL or default URL if not configured</returns>
        private string GetPowerAutomateUrlFromSettings()
        {
            try
            {
                var settings = UserSettings.Load();
                return !string.IsNullOrEmpty(settings.PowerAutomateUrl)
                    ? settings.PowerAutomateUrl
                    : "https://default-powerautomate-url.com";
            }
            catch (Exception ex)
            {
                // Log warning but don't throw - return default URL
                _logger.Warning(ex, "Could not load PowerAutomate URL from settings");
                return "https://default-powerautomate-url.com";
            }
        }

        /// <summary>
        /// Scans hyperlinks in a specific OpenXML element.
        /// </summary>
        private void ScanHyperlinksInElement(OpenXmlElement element, OpenXmlPart part,
            List<DetailedHyperlinkInfo> hyperlinks, bool validateLinks)
        {
            var hyperlinkElements = element.Descendants<Hyperlink>().ToList();

            foreach (var hyperlink in hyperlinkElements)
            {
                try
                {
                    var hyperlinkInfo = CreateDetailedHyperlinkInfo(hyperlink, part);

                    if (validateLinks)
                    {
                        ValidateHyperlink(hyperlinkInfo);
                    }

                    hyperlinks.Add(hyperlinkInfo);
                }
                catch (Exception ex)
                {
                    // Create a partial hyperlink info for error cases
                    var errorInfo = new DetailedHyperlinkInfo
                    {
                        Element = hyperlink,
                        ContainingPart = part,
                        IsValid = false,
                        ValidationMessage = $"Error scanning hyperlink: {ex.Message}",
                        DisplayText = string.Join("", hyperlink.Descendants<Text>().Select(t => t.Text))
                    };
                    hyperlinks.Add(errorInfo);
                    _logger.Warning(ex, "Error scanning hyperlink in document");
                }
            }
        }

        /// <summary>
        /// Advanced hyperlink fixing using API services and intelligent updates.
        /// </summary>
        private async Task<HyperlinkFixingResult> PerformAdvancedHyperlinkFixingAsync(WordprocessingDocument document, HyperlinkFixingOptions options)
        {
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            var result = new HyperlinkFixingResult();

            try
            {
                // Validate document structure
                if (document.MainDocumentPart?.Document?.Body == null)
                {
                    throw new InvalidOperationException("Document structure is invalid or corrupted");
                }

                // Phase 1: Extract hyperlink data with relationship IDs
                var hyperlinkData = await ExtractHyperlinkDataAsync(document);
                result.TotalHyperlinks = hyperlinkData.Count;

                // Filter hyperlinks that have extractable IDs
                var processableHyperlinks = hyperlinkData.Where(h => !string.IsNullOrEmpty(h.Url)).ToList();
                result.ProcessedHyperlinks = processableHyperlinks.Count;

                if (processableHyperlinks.Count == 0)
                {
                    result.Success = true;
                    result.ErrorMessages.Add("No processable hyperlinks found in the document");
                    return result;
                }

                // Phase 2: API Communication (if configured)
                if (!string.IsNullOrEmpty(options.PowerAutomateUrl))
                {
                    var urls = processableHyperlinks.Select(h => h.Url).ToList();
                    var apiSettings = new HyperlinkApiSettings
                    {
                        ApiUrl = options.PowerAutomateUrl,
                        TimeoutSeconds = 30
                    };

                    try
                    {
                        var apiResponse = await _apiService.ProcessHyperlinksAsync(urls, apiSettings);
                        if (apiResponse?.Body?.Results != null)
                        {
                            // Apply API-based fixes
                            result.UpdatedUrls += ApplyApiBasedFixes(processableHyperlinks, apiResponse, options);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.Warning(ex, "API communication failed, falling back to basic fixing");
                        // Continue with basic fixing even if API fails
                    }
                }

                // Phase 3: Apply basic content ID appending if configured
                if (options.AppendContentId)
                {
                    result.UpdatedUrls += await AppendContentIdToHyperlinksAsync(document, "#content");
                }

                // Phase 4: Update titles if requested
                if (options.UpdateTitles)
                {
                    result.UpdatedDisplayTexts += UpdateHyperlinkTitles(processableHyperlinks);
                }

                result.Success = true;
            }
            catch (Exception ex)
            {
                result.ErrorMessages.Add($"Unexpected error during hyperlink fixing: {ex.Message}");
                _logger.Error(ex, "Error in advanced hyperlink fixing");
            }
            finally
            {
                stopwatch.Stop();
                result.Duration = stopwatch.Elapsed;
            }

            return result;
        }

        /// <summary>
        /// Extracts hyperlink data from the document for advanced processing.
        /// </summary>
        private async Task<List<DetailedHyperlinkInfo>> ExtractHyperlinkDataAsync(WordprocessingDocument document)
        {
            return await ScanHyperlinksAsync(document, false);
        }

        /// <summary>
        /// Applies API-based fixes to hyperlinks.
        /// </summary>
        private int ApplyApiBasedFixes(List<DetailedHyperlinkInfo> hyperlinks, HyperlinkApiResponse apiResponse, HyperlinkFixingOptions options)
        {
            int updatedCount = 0;

            if (apiResponse?.Body?.Results == null)
                return updatedCount;

            foreach (var hyperlink in hyperlinks)
            {
                // Find matching API result
                var apiResult = apiResponse.Body.Results.FirstOrDefault(r =>
                    hyperlink.Url.Contains(r.Document_ID, StringComparison.OrdinalIgnoreCase) ||
                    hyperlink.Url.Contains(r.Content_ID, StringComparison.OrdinalIgnoreCase));

                if (apiResult != null && !string.IsNullOrEmpty(apiResult.Title))
                {
                    // Update hyperlink with API data
                    if (UpdateHyperlinkUrl(hyperlink, $"https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid={apiResult.Document_ID}"))
                    {
                        updatedCount++;
                    }
                }
            }

            return updatedCount;
        }

        /// <summary>
        /// Updates hyperlink titles based on their URLs.
        /// </summary>
        private int UpdateHyperlinkTitles(List<DetailedHyperlinkInfo> hyperlinks)
        {
            int updatedCount = 0;

            foreach (var hyperlink in hyperlinks)
            {
                try
                {
                    // Extract meaningful title from URL or existing text
                    var newTitle = ExtractTitleFromUrl(hyperlink.Url) ?? hyperlink.DisplayText;
                    if (!string.IsNullOrEmpty(newTitle) && newTitle != hyperlink.DisplayText)
                    {
                        // Update display text
                        var textElements = hyperlink.Element.Descendants<Text>().ToList();
                        if (textElements.Any())
                        {
                            textElements.First().Text = newTitle;
                            foreach (var extraText in textElements.Skip(1))
                            {
                                extraText.Remove();
                            }
                            updatedCount++;
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.Warning(ex, "Error updating hyperlink title for {Url}", hyperlink.Url);
                }
            }

            return updatedCount;
        }

        /// <summary>
        /// Finds all hyperlinks in a document that match the specified patterns.
        /// </summary>
        /// <param name="documentPath">Path to the document to search</param>
        /// <param name="urlPattern">Regex pattern to match URLs</param>
        /// <param name="displayPattern">Optional regex pattern to match display text</param>
        /// <returns>List of matching hyperlinks</returns>
        public async Task<List<HyperlinkMatch>> FindHyperlinksAsync(string documentPath, string urlPattern, string? displayPattern = null)
        {
            var matches = new List<HyperlinkMatch>();

            if (!File.Exists(documentPath))
            {
                _logger.Warning("Document not found: {DocumentPath}", documentPath);
                return matches;
            }

            try
            {
                using var document = WordprocessingDocument.Open(documentPath, false);

                var urlRegex = new Regex(urlPattern, RegexOptions.IgnoreCase);
                var displayRegex = !string.IsNullOrWhiteSpace(displayPattern)
                    ? new Regex(displayPattern, RegexOptions.IgnoreCase)
                    : null;

                await Task.Run(() =>
                {
                    // Search in main document
                    if (document.MainDocumentPart?.Document?.Body != null)
                    {
                        var mainMatches = FindHyperlinksInPart(document.MainDocumentPart.Document.Body,
                            document.MainDocumentPart, urlRegex, displayRegex, documentPath);
                        matches.AddRange(mainMatches);
                    }

                    // Search in headers
                    var headerParts = document.MainDocumentPart?.HeaderParts;
                    if (headerParts != null)
                    {
                        foreach (var headerPart in headerParts)
                        {
                            var headerMatches = FindHyperlinksInPart(headerPart.Header, headerPart, urlRegex, displayRegex, documentPath);
                            matches.AddRange(headerMatches);
                        }
                    }

                    // Search in footers
                    var footerParts = document.MainDocumentPart?.FooterParts;
                    if (footerParts != null)
                    {
                        foreach (var footerPart in footerParts)
                        {
                            var footerMatches = FindHyperlinksInPart(footerPart.Footer, footerPart, urlRegex, displayRegex, documentPath);
                            matches.AddRange(footerMatches);
                        }
                    }
                });
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Error finding hyperlinks in document: {DocumentPath}", documentPath);
            }

            return matches;
        }

        /// <summary>
        /// Replaces hyperlinks matching specified patterns with new values.
        /// </summary>
        /// <param name="documentPath">Path to the document to update</param>
        /// <param name="urlPattern">Regex pattern to match URLs for replacement</param>
        /// <param name="newUrl">New URL to replace matches with</param>
        /// <param name="newDisplayText">Optional new display text</param>
        /// <param name="displayPattern">Optional regex pattern to match display text</param>
        /// <returns>Result containing replacement statistics</returns>
        public async Task<HyperlinkReplacementResult> ReplaceHyperlinksAsync(string documentPath, string urlPattern,
            string newUrl, string? newDisplayText = null, string? displayPattern = null)
        {
            var result = new HyperlinkReplacementResult();

            if (!File.Exists(documentPath))
            {
                result.Errors.Add($"Document not found: {documentPath}");
                return result;
            }

            try
            {
                using var document = WordprocessingDocument.Open(documentPath, true);

                var urlRegex = new Regex(urlPattern, RegexOptions.IgnoreCase);
                var displayRegex = !string.IsNullOrWhiteSpace(displayPattern)
                    ? new Regex(displayPattern, RegexOptions.IgnoreCase)
                    : null;

                await Task.Run(() =>
                {
                    // Replace in main document
                    if (document.MainDocumentPart?.Document?.Body != null)
                    {
                        var mainResult = ReplaceHyperlinksInPart(document.MainDocumentPart.Document.Body,
                            document.MainDocumentPart, urlRegex, newUrl, newDisplayText, displayRegex);
                        result.TotalMatches += mainResult.matches;
                        result.SuccessfulReplacements += mainResult.replacements;
                        result.FailedReplacements += mainResult.failures;
                    }

                    // Replace in headers
                    var headerParts = document.MainDocumentPart?.HeaderParts;
                    if (headerParts != null)
                    {
                        foreach (var headerPart in headerParts)
                        {
                            var headerResult = ReplaceHyperlinksInPart(headerPart.Header, headerPart,
                                urlRegex, newUrl, newDisplayText, displayRegex);
                            result.TotalMatches += headerResult.matches;
                            result.SuccessfulReplacements += headerResult.replacements;
                            result.FailedReplacements += headerResult.failures;
                        }
                    }

                    // Replace in footers
                    var footerParts = document.MainDocumentPart?.FooterParts;
                    if (footerParts != null)
                    {
                        foreach (var footerPart in footerParts)
                        {
                            var footerResult = ReplaceHyperlinksInPart(footerPart.Footer, footerPart,
                                urlRegex, newUrl, newDisplayText, displayRegex);
                            result.TotalMatches += footerResult.matches;
                            result.SuccessfulReplacements += footerResult.replacements;
                            result.FailedReplacements += footerResult.failures;
                        }
                    }
                });
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Error replacing hyperlinks in document: {DocumentPath}", documentPath);
                result.Errors.Add($"Error replacing hyperlinks: {ex.Message}");
            }

            return result;
        }

        /// <summary>
        /// Finds hyperlinks in a specific document part.
        /// </summary>
        private List<HyperlinkMatch> FindHyperlinksInPart(OpenXmlElement element, OpenXmlPart part,
            Regex urlRegex, Regex? displayRegex, string documentPath)
        {
            var matches = new List<HyperlinkMatch>();
            var hyperlinks = element.Descendants<Hyperlink>().ToList();

            foreach (var hyperlink in hyperlinks)
            {
                try
                {
                    var hyperlinkInfo = CreateDetailedHyperlinkInfo(hyperlink, part);

                    // Check if URL matches pattern
                    if (!string.IsNullOrEmpty(hyperlinkInfo.Url) && urlRegex.IsMatch(hyperlinkInfo.Url))
                    {
                        // Check display text pattern if specified
                        if (displayRegex == null || displayRegex.IsMatch(hyperlinkInfo.DisplayText))
                        {
                            matches.Add(new HyperlinkMatch
                            {
                                CurrentUrl = hyperlinkInfo.Url,
                                DisplayText = hyperlinkInfo.DisplayText,
                                Context = hyperlinkInfo.Context ?? string.Empty,
                                DocumentPath = documentPath,
                                RelationshipId = hyperlinkInfo.Id,
                                HyperlinkElement = hyperlink,
                                ContainingPart = part
                            });
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.Warning(ex, "Error processing hyperlink during search");
                }
            }

            return matches;
        }

        /// <summary>
        /// Replaces hyperlinks in a specific document part.
        /// </summary>
        private (int matches, int replacements, int failures) ReplaceHyperlinksInPart(OpenXmlElement element, OpenXmlPart part,
            Regex urlRegex, string newUrl, string? newDisplayText, Regex? displayRegex)
        {
            int matches = 0, replacements = 0, failures = 0;
            var hyperlinks = element.Descendants<Hyperlink>().ToList();

            foreach (var hyperlink in hyperlinks)
            {
                try
                {
                    var hyperlinkInfo = CreateDetailedHyperlinkInfo(hyperlink, part);

                    // Check if URL matches pattern
                    if (!string.IsNullOrEmpty(hyperlinkInfo.Url) && urlRegex.IsMatch(hyperlinkInfo.Url))
                    {
                        // Check display text pattern if specified
                        if (displayRegex == null || displayRegex.IsMatch(hyperlinkInfo.DisplayText))
                        {
                            matches++;

                            // Replace URL
                            if (UpdateHyperlinkUrl(hyperlinkInfo, newUrl))
                            {
                                // Replace display text if specified
                                if (!string.IsNullOrEmpty(newDisplayText))
                                {
                                    var textElements = hyperlink.Descendants<Text>().ToList();
                                    if (textElements.Any())
                                    {
                                        textElements.First().Text = newDisplayText;
                                        foreach (var extraText in textElements.Skip(1))
                                        {
                                            extraText.Remove();
                                        }
                                    }
                                }

                                replacements++;
                            }
                            else
                            {
                                failures++;
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.Warning(ex, "Error replacing hyperlink");
                    failures++;
                }
            }

            return (matches, replacements, failures);
        }

        /// <summary>
        /// Extracts a meaningful title from a URL.
        /// </summary>
        private string? ExtractTitleFromUrl(string url)
        {
            try
            {
                if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
                {
                    // Extract title from path or query parameters
                    var segments = uri.Segments;
                    if (segments.Length > 0)
                    {
                        var lastSegment = segments[segments.Length - 1].Trim('/', '\\');
                        if (!string.IsNullOrEmpty(lastSegment) && lastSegment.Length > 3)
                        {
                            return Uri.UnescapeDataString(lastSegment);
                        }
                    }
                }
            }
            catch
            {
                // Return null if extraction fails
            }

            return null;
        }

        #endregion

        #region IHyperlinkService Implementation

        /// <summary>
        /// Extracts hyperlinks from a document file
        /// </summary>
        /// <param name="filePath">Path to the document file</param>
        /// <returns>List of hyperlink information</returns>
        public async Task<List<Models.HyperlinkInfo>> ExtractHyperlinksAsync(string filePath)
        {
            if (string.IsNullOrWhiteSpace(filePath))
                throw new ArgumentException("File path cannot be null or empty", nameof(filePath));

            if (!File.Exists(filePath))
                throw new FileNotFoundException($"File not found: {filePath}");

            return await Task.Run(() =>
            {
                using var document = WordprocessingDocument.Open(filePath, false);
                return ExtractHyperlinks(document);
            });
        }

        /// <summary>
        /// Updates a specific hyperlink URL in a document
        /// </summary>
        /// <param name="filePath">Path to the document file</param>
        /// <param name="oldUrl">The URL to replace</param>
        /// <param name="newUrl">The new URL</param>
        /// <returns>True if successful</returns>
        public async Task<bool> UpdateHyperlinkAsync(string filePath, string oldUrl, string newUrl)
        {
            if (string.IsNullOrWhiteSpace(filePath))
                throw new ArgumentException("File path cannot be null or empty", nameof(filePath));

            if (!File.Exists(filePath))
                throw new FileNotFoundException($"File not found: {filePath}");

            return await Task.Run(() =>
            {
                try
                {
                    using var document = WordprocessingDocument.Open(filePath, true);
                    var hyperlinks = ExtractHyperlinks(document);
                    var targetHyperlink = hyperlinks.FirstOrDefault(h => h.Url == oldUrl);

                    if (targetHyperlink != null)
                    {
                        // Find and update the hyperlink element directly
                        var hyperlinkElements = document.MainDocumentPart?.Document?.Body?.Descendants<Hyperlink>() ?? Enumerable.Empty<Hyperlink>();
                        foreach (var hyperlink in hyperlinkElements)
                        {
                            if (hyperlink.Id?.Value == targetHyperlink.Id)
                            {
                                // Update the hyperlink URL
                                var relationshipId = hyperlink.Id.Value;
                                var relationship = document.MainDocumentPart?.ExternalRelationships?.FirstOrDefault(r => r.Id == relationshipId);
                                if (relationship != null && document.MainDocumentPart != null)
                                {
                                    var mainPart = document.MainDocumentPart; // Store reference to avoid null warnings
                                    mainPart.DeleteExternalRelationship(relationship);
                                    var newRelationship = mainPart.AddExternalRelationship(
                                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
                                        new Uri(newUrl, UriKind.Absolute));
                                    hyperlink.Id = newRelationship.Id;
                                    return true;
                                }
                            }
                        }
                    }
                    return false;
                }
                catch (Exception ex)
                {
                    _logger.Error(ex, "Error updating hyperlink in document: {FilePath}", filePath);
                    return false;
                }
            });
        }

        /// <summary>
        /// Updates multiple hyperlinks in a document based on URL mappings
        /// </summary>
        /// <param name="filePath">Path to the document file</param>
        /// <param name="urlMappings">Dictionary mapping old URLs to new URLs</param>
        /// <returns>Number of hyperlinks updated</returns>
        public async Task<int> UpdateAllHyperlinksAsync(string filePath, Dictionary<string, string> urlMappings)
        {
            if (string.IsNullOrWhiteSpace(filePath))
                throw new ArgumentException("File path cannot be null or empty", nameof(filePath));

            if (!File.Exists(filePath))
                throw new FileNotFoundException($"File not found: {filePath}");

            if (urlMappings == null || urlMappings.Count == 0)
                return 0;

            return await Task.Run(() =>
            {
                try
                {
                    using var document = WordprocessingDocument.Open(filePath, true);
                    var hyperlinks = ExtractHyperlinks(document);
                    int updatedCount = 0;

                    foreach (var hyperlink in hyperlinks)
                    {
                        if (urlMappings.TryGetValue(hyperlink.Url, out var newUrl))
                        {
                            // Find and update the hyperlink element directly
                            var hyperlinkElements = document.MainDocumentPart?.Document?.Body?.Descendants<Hyperlink>() ?? Enumerable.Empty<Hyperlink>();
                            foreach (var hyperlinkElement in hyperlinkElements)
                            {
                                if (hyperlinkElement.Id?.Value == hyperlink.Id)
                                {
                                    var relationshipId = hyperlinkElement.Id.Value;
                                    var relationship = document.MainDocumentPart?.ExternalRelationships?.FirstOrDefault(r => r.Id == relationshipId);
                                    if (relationship != null && document.MainDocumentPart != null)
                                    {
                                        document.MainDocumentPart.DeleteExternalRelationship(relationship);
                                        var newRelationship = document.MainDocumentPart.AddExternalRelationship(
                                            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
                                            new Uri(newUrl, UriKind.Absolute));
                                        hyperlinkElement.Id = newRelationship.Id;
                                        updatedCount++;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    return updatedCount;
                }
                catch (Exception ex)
                {
                    _logger.Error(ex, "Error updating hyperlinks in document: {FilePath}", filePath);
                    return 0;
                }
            });
        }

        /// <summary>
        /// Validates if a URL is well-formed and uses valid schemes.
        /// </summary>
        /// <param name="url">The URL to validate</param>
        /// <returns>True if valid</returns>
        public async Task<bool> ValidateHyperlinkAsync(string url)
        {
            return await Task.Run(() =>
            {
                if (string.IsNullOrWhiteSpace(url))
                    return false;

                // Allow internal links starting with #
                if (url.StartsWith("#"))
                    return true;

                // Validate as URI
                if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
                {
                    // Allow common schemes
                    return uri.Scheme == Uri.UriSchemeHttp ||
                           uri.Scheme == Uri.UriSchemeHttps ||
                           uri.Scheme == Uri.UriSchemeFtp ||
                           uri.Scheme == Uri.UriSchemeMailto ||
                           uri.Scheme == Uri.UriSchemeFile;
                }

                return false;
            });
        }

        /// <summary>
        /// Performs detailed validation of a single hyperlink.
        /// </summary>
        /// <param name="hyperlinkInfo">The hyperlink to validate</param>
        public void ValidateHyperlink(DetailedHyperlinkInfo hyperlinkInfo)
        {
            if (string.IsNullOrEmpty(hyperlinkInfo.Url))
            {
                hyperlinkInfo.IsValid = false;
                hyperlinkInfo.ValidationMessage = "Hyperlink has no URL";
                return;
            }

            if (hyperlinkInfo.IsInternal)
            {
                // For internal links, basic validation
                if (!hyperlinkInfo.Url.StartsWith("#"))
                {
                    hyperlinkInfo.IsValid = false;
                    hyperlinkInfo.ValidationMessage = "Internal hyperlink should start with #";
                }
            }
            else
            {
                // For external links, basic URL format validation
                if (!Uri.TryCreate(hyperlinkInfo.Url, UriKind.Absolute, out var uri))
                {
                    hyperlinkInfo.IsValid = false;
                    hyperlinkInfo.ValidationMessage = "Invalid URL format";
                }
                else if (uri.Scheme != "http" && uri.Scheme != "https" && uri.Scheme != "mailto")
                {
                    hyperlinkInfo.IsValid = false;
                    hyperlinkInfo.ValidationMessage = $"Unsupported URL scheme: {uri.Scheme}";
                }
            }
        }

        /// <summary>
        /// Extracts hyperlinks from an open WordprocessingDocument
        /// </summary>
        /// <param name="document">The document to extract hyperlinks from</param>
        /// <returns>List of hyperlink information</returns>
        public List<Models.HyperlinkInfo> ExtractHyperlinks(WordprocessingDocument document)
        {
            if (document == null)
                throw new ArgumentNullException(nameof(document));

            // Use internal scanning method and convert to public model
            var detailedHyperlinks = ScanHyperlinksAsync(document, false).GetAwaiter().GetResult();

            // Convert DetailedHyperlinkInfo to public Models.HyperlinkInfo for backward compatibility
            return detailedHyperlinks.Select(h => new Models.HyperlinkInfo
            {
                Id = h.Id,
                Url = h.Url,
                DisplayText = h.DisplayText,
                Type = h.IsInternal ? HyperlinkType.Internal : HyperlinkType.External,
                IsValid = h.IsValid,
                ValidationMessage = h.ValidationMessage,
                Tooltip = string.Empty // Not available in DetailedHyperlinkInfo
            }).ToList();
        }

        #endregion
    }


    /// <summary>
    /// Represents a hyperlink found in the document.
    /// </summary>
    public class HyperlinkMatch
    {
        public string CurrentUrl { get; set; } = string.Empty;
        public string DisplayText { get; set; } = string.Empty;
        public string Context { get; set; } = string.Empty;
        public string DocumentPath { get; set; } = string.Empty;
        public string RelationshipId { get; set; } = string.Empty;
        public Hyperlink HyperlinkElement { get; set; } = null!;
        public OpenXmlPart ContainingPart { get; set; } = null!;
    }

    /// <summary>
    /// Result of hyperlink replacement operation.
    /// </summary>
    public class HyperlinkReplacementResult
    {
        public int TotalMatches { get; set; }
        public int SuccessfulReplacements { get; set; }
        public int FailedReplacements { get; set; }
        public List<string> Errors { get; set; } = new();
        public bool IsSuccess => FailedReplacements == 0;
    }

}
