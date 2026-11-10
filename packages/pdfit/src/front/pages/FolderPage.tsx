import BulkManualTagDialog from '../components/BulkManualTagDialog';
import FolderDestinationPicker from '../components/FolderDestinationPicker';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Typography, List, IconButton, Tooltip, Button, CircularProgress, Alert, LinearProgress, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Select, FormControl, InputLabel, Chip, Checkbox, ToggleButton, ToggleButtonGroup, Autocomplete, TextField, useTheme, InputAdornment, } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteIcon from '@mui/icons-material/Delete';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import ClearIcon from '@mui/icons-material/Clear';
import SearchIcon from '@mui/icons-material/Search';
import FindInPageOutlinedIcon from '@mui/icons-material/FindInPageOutlined';
import ViewListIcon from '@mui/icons-material/ViewList';
import GridViewIcon from '@mui/icons-material/GridView';
import { foldersApi, FolderInfo, type PdfInfo } from '../api/folders';
import { prepareDroppedPdfFile } from '../upload/resumableUpload';
import { tagsApi } from '../api/tags';
import PdfListItem from '../components/PdfListItem';
import PdfListHeader from '../components/PdfListHeader';
import LibraryFixedControls from '../components/LibraryFixedControls';
import PdfCoverItem from '../components/PdfCoverItem';
import BookMetadataDialog, { type BookMetadataTarget } from '../components/BookMetadataDialog';
import { queueAutomaticCoverLookup } from '../api/bookMetadata';
import { fileIdentity, folderLibraryModel } from '../model/folderLibraryModel';
import { useFolderLibrary } from '../hooks/useFolderLibrary';
import { usePdfitI18n, useTranslatedDisplayText } from '../i18n/usePdfitI18n';
import { isPendingUploadDriveFileId } from '../viewer/openViewer';
import { usePdfitFrontConfig } from '../context';
import { publishTagSummaryOptimistic } from '../model/tagSummaryEvents';
import TagNoticeSnackbar, { type TagNotice } from '../components/TagNoticeSnackbar';
import TagColorPicker, { lastTagInputColor, rememberTagInputColor } from '../components/TagColorPicker';
import TagChip from '../components/TagChip';
import HashTagIcon from '../components/HashTagIcon';
import { synchronizeLibraryMetadata } from '../model/libraryMetadataSync.js';
import SelectedDocumentActions from '../components/SelectedDocumentActions';
function normalizePdfSearch(value: string): string { return value.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim(); }
function DisplayText({ value }: {
    value: string;
}) { return <>{useTranslatedDisplayText(value)}</>; }
interface TagDialogState {
    file: string;
    driveFileId?: string;
    currentTags: string[];
}
function FolderPage({ folderName: requestedFolderName }: {
    folderName?: string;
}) {
    const { language, t, ui } = usePdfitI18n();
    const theme = useTheme();
    const aiAccentColor = theme.palette.mode === 'light' ? '#b7791f' : '#f59e0b';
    const aiAccentHover = theme.palette.mode === 'light' ? '#956318' : '#fbbf24';
    const aiAccentContrast = theme.palette.mode === 'light' ? '#ffffff' : '#251703';
    const { aiAutoTagAccess, aiBulkTagLimit, onAiTagProcessed, onAiTagRemoved, bookMetadataEnabled, bookResearchAccess, serverThumbnails } = usePdfitFrontConfig();
    const canUseAiAutoTag = aiAutoTagAccess?.() ?? true;
    const bulkTagLimit = aiBulkTagLimit?.() ?? null;
    const canUseAiBulkTag = canUseAiAutoTag || (bulkTagLimit !== null && bulkTagLimit > 0);
    const aiTrialExhausted = !canUseAiAutoTag && bulkTagLimit === 0;
    const bulkTagActionLabel = canUseAiAutoTag ? t("aiAutoTagAll") : aiTrialExhausted ? ui("유료 이용권 안내") : ui("AI 자동태그 사용해보기");
    const { name } = useParams<{
        name: string;
    }>();
    const navigate = useNavigate();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const folderName = requestedFolderName ?? decodeURIComponent(name ?? '');
    const [error, setError] = useState<string | null>(null);
    const folderModel = folderLibraryModel.get(folderName);
    const { files, fileTags, isRootFolder, loading, tagsLoaded, error: loadError } = useFolderLibrary(folderName);
    const autoTagTargets = files.filter((file) => {
        if (isPendingUploadDriveFileId(file.driveFileId))
            return false;
        const tags = fileTags[fileIdentity(file.name, file.driveFileId)] ?? fileTags[file.name] ?? [];
        return tags.length === 0;
    });
    // 업로드
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadPhase, setUploadPhase] = useState<'uploading' | 'indexing' | 'refreshing'>('uploading');
    const [dragActive, setDragActive] = useState(false); // 이동 다이얼로그
    const [moveDialog, setMoveDialog] = useState<{
        file: string;
        driveFileId?: string;
    } | null>(null);
    const [allFolders, setAllFolders] = useState<FolderInfo[]>([]);
    const [moveTarget, setMoveTarget] = useState('');
    const [moving, setMoving] = useState(false); // 태그 다이얼로그
    const [tagDialog, setTagDialog] = useState<TagDialogState | null>(null);
    const [allTags, setAllTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    const [tagInputColor, setTagInputColor] = useState(lastTagInputColor);
    const [tagLoading, setTagLoading] = useState(false);
    const [tagMutation, setTagMutation] = useState<string | null>(null);
    const [tagNotice, setTagNotice] = useState<TagNotice | null>(null);
    const [confirmAutoTagAll, setConfirmAutoTagAll] = useState(false);
    const [confirmClearFolderTags, setConfirmClearFolderTags] = useState(false);
    const [bulkAutoTagProgress, setBulkAutoTagProgress] = useState<{
        completed: number;
        total: number;
    } | null>(null);
    const [bulkAutoTagCancelling, setBulkAutoTagCancelling] = useState(false);
    const bulkAutoTagCancellationRef = useRef<{
        cancelled: boolean;
    } | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [tagColors, setTagColors] = useState<Record<string, string>>({});
    const [confirmDelete, setConfirmDelete] = useState<{
        kind: 'file';
        name: string;
        driveFileId?: string;
    } | {
        kind: 'folder';
        name: string;
    } | {
        kind: 'selection';
        files: Array<{
            name: string;
            driveFileId?: string;
            selectionKey: string;
        }>;
    } | null>(null);
    const [bulkManualDocuments, setBulkManualDocuments] = useState<{
        folder: string;
        filename: string;
        driveFileId?: string;
    }[] | null>(null);
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set());
    const [pdfSearch, setPdfSearch] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [libraryView, setLibraryView] = useState<'list' | 'covers'>(() => window.localStorage.getItem('pdfit.library.view') === 'covers' ? 'covers' : 'list');
    const [deletingSelection, setDeletingSelection] = useState(false);
    const [metadataTarget, setMetadataTarget] = useState<BookMetadataTarget | null>(null);
    const [coverVersions, setCoverVersions] = useState<Record<string, number>>({});
    const selectionKeys = new Map<PdfInfo, string>();
    const identityOccurrences = new Map<string, number>();
    for (const file of files) {
        const identity = fileIdentity(file.name, file.driveFileId);
        const occurrence = identityOccurrences.get(identity) ?? 0;
        identityOccurrences.set(identity, occurrence + 1);
        selectionKeys.set(file, `${identity}\u0000${occurrence}`);
    }
    const selectionKey = (file: PdfInfo) => selectionKeys.get(file) ?? fileIdentity(file.name, file.driveFileId);
    const bulkAutoTagTargets = canUseAiAutoTag ? autoTagTargets : files.filter(file => selectedFiles.has(selectionKey(file)) && !isPendingUploadDriveFileId(file.driveFileId));
    const aiSelectionOverLimit = !canUseAiAutoTag && bulkTagLimit !== null && bulkAutoTagTargets.length > bulkTagLimit;
    const normalizedPdfSearch = normalizePdfSearch(pdfSearch);
    const searchTerms = normalizedPdfSearch.split(' ').filter(Boolean);
    const visibleFiles = (normalizedPdfSearch ? files.filter((file) => { const identity = fileIdentity(file.name, file.driveFileId); const tags = fileTags[identity] ?? fileTags[file.name] ?? []; const searchable = normalizePdfSearch(`${file.name} ${tags.join(' ')}`); return searchTerms.every((term) => searchable.includes(term)); }) : files).slice().sort((a, b) => (b.uploadedAt ?? b.modifiedAt).localeCompare(a.uploadedAt ?? a.modifiedAt) || a.name.localeCompare(b.name, 'ko'));
    useEffect(() => { setSelectedFiles(new Set()); setPdfSearch(''); setSearchOpen(false); }, [folderName]);
    useEffect(() => () => {
        if (bulkAutoTagCancellationRef.current)
            bulkAutoTagCancellationRef.current.cancelled = true;
    }, [folderName]);
    useEffect(() => { const available = new Set(files.map(selectionKey)); setSelectedFiles((current) => { const next = new Set([...current].filter((identity) => available.has(identity))); return next.size === current.size ? current : next; }); }, [files]);
    useEffect(() => { const loadColors = () => void tagsApi.listSummary().then((items) => setTagColors(Object.fromEntries(items.map((item) => [item.name, item.color])))); loadColors(); window.addEventListener('tags-changed', loadColors); return () => window.removeEventListener('tags-changed', loadColors); }, []);
    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await foldersApi.refresh();
            await synchronizeLibraryMetadata();
            await folderModel.refresh();
            window.dispatchEvent(new Event('folders-changed'));
            window.dispatchEvent(new Event('tags-changed'));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : ui("새로고침에 실패했습니다."));
        }
        finally {
            setRefreshing(false);
        }
    }; // LNB 드래그 드롭으로 태그가 추가됐을 때 즉시 반영
    useEffect(() => {
        const onTagAdded = (e: Event) => {
            const { folder, filename, driveFileId, tag } = (e as CustomEvent<{
                folder: string;
                filename: string;
                driveFileId?: string;
                tag: string;
            }>).detail;
            if (folder !== folderName)
                return;
            folderModel.addTag(filename, tag, driveFileId);
        };
        window.addEventListener('tag-added', onTagAdded);
        return () => window.removeEventListener('tag-added', onTagAdded);
    }, [folderName, folderModel]);
    const uploadFiles = useCallback(async (selected: File[]) => {
        if (selected.length === 0 || uploading)
            return;
        setError(null);
        setUploading(true);
        setUploadProgress(0);
        setUploadPhase('uploading');
        try {
            await foldersApi.upload(folderName, selected, setUploadProgress, setUploadPhase);
            setUploadProgress(100);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : ui("업로드 실패"));
        }
        finally {
            setUploading(false);
            setUploadProgress(0);
        }
    }, [folderModel, folderName, uploading]);
    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => { const selected = Array.from(e.target.files ?? []); e.target.value = ''; await uploadFiles(selected); };
    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes('Files') || uploading)
            return;
        e.preventDefault();
        dragDepthRef.current += 1;
        setDragActive(true);
    };
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes('Files') || uploading)
            return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes('Files'))
            return;
        e.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0)
            setDragActive(false);
    };
    const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        if (!e.dataTransfer.types.includes('Files'))
            return;
        e.preventDefault();
        dragDepthRef.current = 0;
        setDragActive(false);
        if (uploading)
            return;
        const transferredFiles = Array.from(e.dataTransfer.files);
        const dropped = transferredFiles.length > 0 ? transferredFiles : Array.from(e.dataTransfer.items).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((file): file is File => file !== null);
        const pdfFiles = (await Promise.all(dropped.map(prepareDroppedPdfFile))).filter((file): file is File => file !== null);
        if (pdfFiles.length === 0) {
            setError(ui("PDF 파일만 업로드할 수 있습니다."));
            return;
        }
        await uploadFiles(pdfFiles);
        if (pdfFiles.length !== dropped.length) {
            setError(ui("PDF가 아닌 파일 {p0}개를 제외했습니다.", { p0: dropped.length - pdfFiles.length }));
        }
    };
    const handleDelete = useCallback((_rowFolder: string, filename: string, driveFileId?: string) => { setConfirmDelete({ kind: 'file', name: filename, driveFileId }); }, []);
    const openDocumentMetadata = useCallback(async (file: {
        name: string;
        driveFileId?: string;
    }) => {
        if (isPendingUploadDriveFileId(file.driveFileId)) {
            setTagNotice({ message: t('pdfStillUploading'), severity: 'info' });
            return;
        }
        let driveFileId = file.driveFileId;
        if (!driveFileId) {
            try {
                await foldersApi.refresh();
                driveFileId = (await foldersApi.listFiles(folderName)).find((candidate) => candidate.name === file.name)?.driveFileId;
            }
            catch {
                driveFileId = undefined;
            }
        }
        if (!driveFileId) {
            setTagNotice({ message: ui("문서 정보를 열기 위한 파일 ID를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요."), severity: 'error' });
            return;
        }
        setMetadataTarget({ driveFileId, filename: file.name });
    }, [folderName, t]);
    const confirmDeleteItem = async () => {
        if (!confirmDelete)
            return;
        const target = confirmDelete;
        setConfirmDelete(null);
        try {
            if (target.kind === 'selection') {
                setDeletingSelection(true);
                const failed: Array<{
                    name: string;
                    driveFileId?: string;
                    selectionKey: string;
                }> = [];
                for (const file of target.files) {
                    try {
                        await foldersApi.deleteFile(folderName, file.name, file.driveFileId);
                        folderModel.removeFile(file.name, file.driveFileId);
                    }
                    catch {
                        failed.push(file);
                    }
                }
                setSelectedFiles(new Set(failed.map((file) => file.selectionKey)));
                if (failed.length > 0) {
                    throw new Error(ui("{p0}개를 삭제했고, {p1}개는 삭제하지 못했습니다.", { p0: target.files.length - failed.length, p1: failed.length }));
                }
            }
            else if (target.kind === 'file') {
                await foldersApi.deleteFile(folderName, target.name, target.driveFileId);
                folderModel.removeFile(target.name, target.driveFileId);
                setSelectedFiles((current) => {
                    const next = new Set(current);
                    for (const file of files) {
                        if (fileIdentity(file.name, file.driveFileId) === fileIdentity(target.name, target.driveFileId))
                            next.delete(selectionKey(file));
                    }
                    return next;
                });
            }
            else {
                await foldersApi.delete(target.name);
                window.dispatchEvent(new Event('folders-changed'));
                navigate('/');
            }
            window.dispatchEvent(new Event('folders-changed'));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : ui("삭제 실패"));
        }
        finally {
            setDeletingSelection(false);
        }
    };
    const handleSelectionChange = useCallback((identity: string, selected: boolean) => {
        setSelectedFiles((current) => {
            const next = new Set(current);
            if (selected)
                next.add(identity);
            else
                next.delete(identity);
            return next;
        });
    }, []);
    const selectableFileIds = visibleFiles.filter((file) => !isPendingUploadDriveFileId(file.driveFileId)).map(selectionKey);
    const allFilesSelected = selectableFileIds.length > 0 && selectableFileIds.every((identity) => selectedFiles.has(identity));
    const handleSelectAll = () => { setSelectedFiles((current) => { const currentlyAllSelected = selectableFileIds.length > 0 && selectableFileIds.every((identity) => current.has(identity)); return currentlyAllSelected ? new Set() : new Set(selectableFileIds); }); };
    const handleDeleteSelection = () => {
        if (selectedFiles.size === 0)
            return;
        setConfirmDelete({ kind: 'selection', files: files.filter((file) => selectedFiles.has(selectionKey(file))).map((file) => ({ name: file.name, driveFileId: file.driveFileId, selectionKey: selectionKey(file) })), });
    };
    const openMoveDialog = useCallback(async (_rowFolder: string, filename: string, driveFileId?: string) => { const folders = await foldersApi.list(); setAllFolders(folders.filter((f) => f.name !== folderName)); setMoveTarget(''); setMoveDialog({ file: filename, driveFileId }); }, [folderName]);
    const handleMove = async () => {
        if (!moveDialog || !moveTarget)
            return;
        setMoving(true);
        try {
            await foldersApi.moveFile(folderName, moveTarget, moveDialog.file, moveDialog.driveFileId);
            folderModel.removeFile(moveDialog.file, moveDialog.driveFileId);
            window.dispatchEvent(new Event('folders-changed'));
            setMoveDialog(null);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : ui("이동 실패"));
        }
        finally {
            setMoving(false);
        }
    }; // ─── 태그 다이얼로그 ──────────────────────────────────────
    const openTagDialog = useCallback(async (_rowFolder: string, filename: string, driveFileId?: string) => {
        if (isPendingUploadDriveFileId(driveFileId)) {
            setTagNotice({ message: t('pdfStillUploading'), severity: 'info' });
            return;
        }
        setTagDialog({ file: filename, driveFileId, currentTags: fileTags[fileIdentity(filename, driveFileId)] ?? fileTags[filename] ?? [] });
        setTagLoading(true);
        setTagInput('');
        try {
            const [currentTags, globalTags] = await Promise.all([tagsApi.listForBook(folderName, filename, driveFileId), tagsApi.list(),]);
            setTagDialog({ file: filename, driveFileId, currentTags });
            setAllTags(globalTags);
        }
        catch {
            setError(ui("태그 로드 실패"));
        }
        finally {
            setTagLoading(false);
        }
    }, [fileTags, folderName, t]);
    const handleAddTag = async (tag: string) => {
        if (!tagDialog || !tag.trim() || tagMutation)
            return false;
        const trimmed = tag.trim();
        const isNewTag = !allTags.includes(trimmed);
        if (tagDialog.currentTags.includes(trimmed)) {
            setTagInput('');
            setTagNotice({ message: ui("\"{p0}\"은(는) 이미 추가된 태그입니다.", { p0: trimmed }), severity: 'info' });
            return true;
        }
        const filename = tagDialog.file;
        const driveFileId = tagDialog.driveFileId;
        setTagMutation(trimmed);
        setTagNotice({ message: ui("\"{p0}\" 태그를 추가하는 중입니다…", { p0: trimmed }), severity: 'info' });
        try {
            await tagsApi.addTag(folderName, filename, trimmed, driveFileId);
            if (isNewTag) {
                try {
                    await tagsApi.updateColor(trimmed, tagInputColor);
                    setTagColors((current) => ({ ...current, [trimmed]: tagInputColor }));
                }
                catch {
                    setTagNotice({ message: ui("태그는 추가했지만 색상을 저장하지 못했습니다."), severity: 'error' });
                    window.dispatchEvent(new Event('tags-changed'));
                    return true;
                }
            }
            setTagDialog((prev) => prev ? { ...prev, currentTags: [...prev.currentTags, trimmed] } : prev);
            folderModel.addTag(filename, trimmed, driveFileId);
            publishTagSummaryOptimistic(trimmed, 1);
            setAllTags((prev) => prev.includes(trimmed) ? prev : [...prev, trimmed].sort());
            setTagInput('');
            window.dispatchEvent(new Event('tags-changed'));
            setTagNotice({ message: ui("\"{p0}\" 태그가 추가되었습니다.", { p0: trimmed }), severity: 'success' });
            return true;
        }
        catch (e) {
            await tagsApi.restoreCachedRelation(folderName, filename, trimmed, false, driveFileId);
            setAllTags(await tagsApi.list());
            setTagDialog((prev) => prev ? { ...prev, currentTags: prev.currentTags.filter((item) => item !== trimmed) } : prev);
            folderModel.removeTag(filename, trimmed, driveFileId);
            const message = e instanceof Error ? e.message : ui("태그 추가 실패");
            setTagNotice({ message: ui("태그를 추가하지 못했습니다. {p0}", { p0: message }), severity: 'error' });
            return false;
        }
        finally {
            setTagMutation(null);
        }
    };
    const handleCloseTagDialog = async () => {
        if (tagMutation)
            return;
        if (tagInput.trim() && !tagDialog?.currentTags.includes(tagInput.trim())) {
            void handleAddTag(tagInput);
        }
        setTagDialog(null);
        setTagInput('');
    };
    const handleRemoveTag = async (tag: string) => {
        if (!tagDialog || tagMutation)
            return;
        const filename = tagDialog.file;
        const driveFileId = tagDialog.driveFileId;
        setTagMutation(tag);
        setTagNotice({ message: ui("\"{p0}\" 태그를 삭제하는 중입니다…", { p0: tag }), severity: 'info' });
        setTagDialog((prev) => prev ? { ...prev, currentTags: prev.currentTags.filter((item) => item !== tag) } : prev);
        folderModel.removeTag(filename, tag, driveFileId);
        publishTagSummaryOptimistic(tag, -1);
        try {
            await tagsApi.removeTag(folderName, filename, tag, driveFileId);
            await onAiTagRemoved?.({ folder: folderName, filename, driveFileId, tag });
            window.dispatchEvent(new Event('tags-changed'));
            setTagNotice({ message: ui("\"{p0}\" 태그가 삭제되었습니다.", { p0: tag }), severity: 'success' });
        }
        catch (e) {
            await tagsApi.restoreCachedRelation(folderName, filename, tag, true, driveFileId);
            setTagDialog((prev) => prev && !prev.currentTags.includes(tag) ? { ...prev, currentTags: [...prev.currentTags, tag] } : prev);
            folderModel.addTag(filename, tag, driveFileId);
            publishTagSummaryOptimistic(tag, 1);
            const message = e instanceof Error ? e.message : ui("태그 삭제 실패");
            setTagNotice({ message: ui("태그를 삭제하지 못했습니다. {p0}", { p0: message }), severity: 'error' });
        }
        finally {
            setTagMutation(null);
        }
    };
    const handleAutoTag = async (file = tagDialog?.file, driveFileId = tagDialog?.driveFileId) => {
        if (!file || tagMutation)
            return;
        if (!canUseAiAutoTag) {
            setTagNotice({ message: t('aiAutoTagPaidOnly'), severity: 'error' });
            return;
        }
        setTagMutation(`__ai_auto_tag__:${file}`);
        setTagNotice({ message: t('aiTaggingInProgress'), severity: 'info' });
        try {
            const result = await tagsApi.autoTag(folderName, file, driveFileId);
            if (result.addedTags.length === 0) {
                setTagNotice({ message: t('aiTagsAlreadyApplied'), severity: 'info' });
                return;
            }
            setTagDialog((previous) => previous ? { ...previous, currentTags: [...new Set([...previous.currentTags.filter((tag) => !result.removedTags.includes(tag)), ...result.addedTags])], } : previous);
            for (const tag of result.addedTags)
                folderModel.addTag(file, tag, driveFileId);
            for (const tag of result.removedTags)
                folderModel.removeTag(file, tag, driveFileId);
            setAllTags((previous) => [...new Set([...previous, ...result.addedTags])].sort());
            if (result.removedTags.length > 0)
                setAllTags((previous) => previous.filter((tag) => !result.removedTags.includes(tag)));
            window.dispatchEvent(new Event('tags-changed'));
            setTagNotice({ message: t('aiTagsAdded', { tags: result.addedTags.join(', ') }), severity: 'success' });
        }
        catch (cause) {
            const message = cause instanceof Error ? cause.message : t('aiTaggingFailed');
            setTagNotice({ message: `${t('aiTaggingFailed')} ${message}`, severity: 'error' });
        }
        finally {
            setTagMutation(null);
        }
    };
    const handleAutoTagAll = async () => {
        let successful = 0;
        let successfulDocuments: Array<{
            folder: string;
            filename: string;
            driveFileId?: string;
            assignedTag?: string;
        }> = [];
        if (tagMutation || files.length === 0)
            return;
        if (!canUseAiBulkTag) {
            setConfirmAutoTagAll(false);
            setTagNotice({ message: t('aiAutoTagPaidOnly'), severity: 'error' });
            return;
        }
        if (aiSelectionOverLimit) { setTagNotice({ message: ui("현재 {p0}개 문서를 추가할 수 있습니다. 선택을 줄여주세요.", { p0: String(bulkTagLimit) }), severity: "info" }); return; }
        const targets = bulkAutoTagTargets;
        if (targets.length === 0)
            return;
        const cancellation = { cancelled: false };
        bulkAutoTagCancellationRef.current = cancellation;
        setBulkAutoTagCancelling(false);
        setTagMutation('__ai_auto_tag_all__');
        setBulkAutoTagProgress({ completed: 0, total: targets.length });
        setTagNotice(null);
        try {
            const result = await tagsApi.autoTagFolder(folderName, targets.map((target) => ({ filename: target.name, driveFileId: target.driveFileId })), (completed, total) => setBulkAutoTagProgress({ completed, total }), () => cancellation.cancelled);
            successful = result.processed;
            successfulDocuments = result.books.map(book => ({ ...book, folder: folderName, driveFileId: book.driveFileId ?? undefined }));
            for (const book of result.books) {
                const assignedTag = book.assignedTag ?? book.addedTags[0];
                if (assignedTag)
                    folderModel.addTag(book.filename, assignedTag, book.driveFileId);
            }
            for (const book of result.books)
                for (const tag of book.removedTags)
                    folderModel.removeTag(book.filename, tag, book.driveFileId);
            setAllTags((previous) => [...new Set([...previous, ...result.books.flatMap((book) => book.assignedTag ? [book.assignedTag] : book.addedTags)])].sort());
            const removedTags = new Set(result.books.flatMap((book) => book.removedTags));
            if (removedTags.size > 0)
                setAllTags((previous) => previous.filter((tag) => !removedTags.has(tag)));
            setBulkAutoTagProgress({ completed: result.processed + result.failed, total: targets.length });
            window.dispatchEvent(new Event('tags-changed'));
            const completed = result.processed + result.failed;
            if (result.cancelled && completed < targets.length) {
                setTagNotice({ message: t('aiTagsAllCancelled', { completed, total: targets.length }), severity: 'info', });
            }
            else if (result.failed > 0) {
                const failedBooks = result.errors.slice(0, 3).map((item) => item.filename).join(', ');
                const remaining = Math.max(0, result.errors.length - 3);
                const message = t('aiTagsAllPartial', { completed: result.processed, failed: result.failed, books: failedBooks, remaining: remaining > 0 ? ` +${remaining}` : '', });
                setTagNotice({ message, severity: 'error' });
            }
            else if (result.addedTags === 0) {
                setTagNotice({ message: t('aiTagsAllNoChanges', { completed: result.processed }), severity: 'success' });
            }
            else {
                setTagNotice({ message: t('aiTagsAllComplete', { completed: result.processed, added: result.addedTags }), severity: 'success' });
            }
        }
        catch (cause) {
            const message = cause instanceof Error ? cause.message : t('aiTaggingFailed');
            setTagNotice({ message: `${t('aiTaggingFailed')} ${message}`, severity: 'error' });
        }
        finally {
            await onAiTagProcessed?.(successful, successfulDocuments);
            if (bulkAutoTagCancellationRef.current === cancellation)
                bulkAutoTagCancellationRef.current = null;
            setBulkAutoTagCancelling(false);
            setTagMutation(null);
            setBulkAutoTagProgress(null);
        }
    };
    const handleCancelAutoTagAll = () => {
        const cancellation = bulkAutoTagCancellationRef.current;
        if (!cancellation || cancellation.cancelled)
            return;
        cancellation.cancelled = true;
        setBulkAutoTagCancelling(true);
    };
    const folderTagRelations = files.flatMap((file) => (fileTags[fileIdentity(file.name, file.driveFileId)] ?? fileTags[file.name] ?? []).map((tag) => ({ filename: file.name, driveFileId: file.driveFileId, tag, })));
    const taggedBookCount = new Set(folderTagRelations.map((relation) => fileIdentity(relation.filename, relation.driveFileId))).size;
    const handleClearFolderTags = async () => {
        if (tagMutation || folderTagRelations.length === 0)
            return;
        const targets = [...folderTagRelations];
        setTagMutation('__clear_folder_tags__');
        setTagNotice({ message: t('clearingFolderTags', { total: targets.length }), severity: 'info' });
        try {
            const result = await tagsApi.clearFolderTags(folderName);
            await onAiTagRemoved?.({ folder: folderName });
            for (const target of targets)
                folderModel.removeTag(target.filename, target.tag, target.driveFileId);
            window.dispatchEvent(new Event('tags-changed'));
            setTagNotice({ message: t('folderTagsCleared', { count: result.removed || targets.length }), severity: 'success' });
        }
        catch (cause) {
            const detail = cause instanceof Error ? cause.message : '';
            const message = `${t('clearFolderTagsFailed')}${detail ? ` ${detail}` : ''}`;
            setTagNotice({ message, severity: 'error' });
        }
        finally {
            setTagMutation(null);
        }
    };
    const handleInlineRemoveTag = useCallback(async (_rowFolder: string, filename: string, tag: string, driveFileId?: string) => {
        if (tagMutation)
            return;
        setTagMutation(tag);
        setTagNotice({ message: ui("\"{p0}\" 태그를 삭제하는 중입니다…", { p0: tag }), severity: 'info' });
        folderModel.removeTag(filename, tag, driveFileId);
        try {
            await tagsApi.removeTag(folderName, filename, tag, driveFileId);
            await onAiTagRemoved?.({ folder: folderName, filename, driveFileId, tag });
            window.dispatchEvent(new Event('tags-changed'));
            setTagNotice({ message: ui("\"{p0}\" 태그가 삭제되었습니다.", { p0: tag }), severity: 'success' });
        }
        catch (e) {
            await tagsApi.restoreCachedRelation(folderName, filename, tag, true, driveFileId);
            folderModel.addTag(filename, tag, driveFileId);
            const message = e instanceof Error ? e.message : ui("태그 삭제 실패");
            setTagNotice({ message: ui("태그를 삭제하지 못했습니다. {p0}", { p0: message }), severity: 'error' });
        }
        finally {
            setTagMutation(null);
        }
    }, [folderModel, folderName, tagMutation]);
    if (loading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
    }
    return (<Box data-testid="folder-drop-zone" aria-label={t('dropPdf')} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={(e) => void handleDrop(e)} sx={{ position: 'relative', minHeight: 'calc(100vh - 96px)' }}>
    {dragActive && (<Box data-testid="pdf-drop-overlay" role="status" aria-live="polite" sx={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, border: '2px dashed', borderColor: 'primary.main', borderRadius: 2, bgcolor: 'rgba(18, 25, 38, 0.92)', backdropFilter: 'blur(2px)', pointerEvents: 'none', }}>
    <UploadFileIcon color="primary" sx={{ fontSize: 56 }}/>
    <Typography variant="h6" fontWeight={700}>{t('dropPdf')}</Typography>
    <Typography variant="body2" color="text.secondary">{t('dropPdfCopy')}</Typography>
    </Box>)}
    {/* 폴더 헤더 */}
    <Box sx={{ px: 1, py: 0, mb: 0.5 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
    <Box data-testid="folder-title-row" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <FolderOpenIcon sx={{ fontSize: 32, color: 'primary.main' }}/>
    <Box data-testid="folder-title-summary" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
    <Typography variant="h5" fontWeight={700}><DisplayText value={folderName}/></Typography>
    </Box>
    </Box>
        {searchOpen ? <TextField autoFocus onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    setPdfSearch('');
                    setSearchOpen(false);
                    setSelectedFiles(new Set());
                }
            }} value={pdfSearch} onChange={(event) => { setPdfSearch(event.target.value); setSelectedFiles(new Set()); }} placeholder={t('searchPdfs')} size="small" inputProps={{ 'aria-label': t('searchPdfs'), 'data-testid': 'pdf-search-input' }} InputProps={{ startAdornment: (<InputAdornment position="start">
            <SearchIcon sx={{ fontSize: 19, color: 'text.secondary' }}/>
            </InputAdornment>), endAdornment: (<InputAdornment position="end" sx={{ gap: 0.25 }}>
            <IconButton aria-label={t('closeSearch')} size="small" onClick={() => { setPdfSearch(''); setSearchOpen(false); setSelectedFiles(new Set()); }} edge="end">
            <ClearIcon sx={{ fontSize: 17 }}/>
            </IconButton>
            </InputAdornment>), }} sx={{ flex: '1 1 240px', width: { xs: '100%', sm: 'auto' }, minWidth: { sm: 210 }, maxWidth: { xs: 'none', sm: 360 }, '& .MuiOutlinedInput-root': { height: 32, bgcolor: 'background.paper' }, }}/> : <Button data-testid="pdf-search-button" size="small" startIcon={<SearchIcon />} onClick={() => setSearchOpen(true)} sx={{ flexShrink: 0 }}>{t('searchPdfs')}</Button>}
    <Box data-testid="folder-header-actions" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1.5, ml: 'auto' }}>
    <Button data-testid="upload-pdf" variant="outlined" size="small" startIcon={<UploadFileIcon />} onClick={() => fileInputRef.current?.click()} disabled={uploading} sx={{ transition: 'background-color 160ms ease', '&:hover': { bgcolor: theme.palette.mode === 'light' ? '#edf4ff' : 'rgba(59,130,246,.18)', borderColor: 'primary.main' } }}>
    {t('upload')}
    </Button>
    <Button data-testid="refresh-folder" variant="outlined" size="small" startIcon={refreshing ? <CircularProgress size={16} color="inherit"/> : <RefreshIcon />} onClick={() => void handleRefresh()} disabled={refreshing || loading} sx={{ transition: 'background-color 160ms ease', '&:hover': { bgcolor: theme.palette.mode === 'light' ? '#edf4ff' : 'rgba(59,130,246,.18)', borderColor: 'primary.main' } }}>
    {t('refresh')}
    </Button>
    <Button data-testid="clear-folder-tags" sx={theme.palette.mode === 'light' ? { color: 'text.secondary', borderColor: '#ccd3dd', '&:hover': { borderColor: '#9298a2', bgcolor: 'action.hover' } } : undefined} variant="outlined" size="small" startIcon={tagMutation === '__clear_folder_tags__' ? <CircularProgress size={16} color="inherit"/> : <LocalOfferIcon />} disabled={folderTagRelations.length === 0 || tagMutation !== null || deletingSelection} onClick={() => setConfirmClearFolderTags(true)}>
    {t('clearAllFolderTags')}
    </Button>
    </Box>
    </Box>
    </Box>
    <LibraryFixedControls>
        {files.length > 0 && (<Box data-testid="folder-list-toolbar" role="toolbar" aria-label={t('bookList')} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mt: 2, px: 0.5, py: 0.5, minHeight: 44, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider', }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}>
        <Tooltip title={allFilesSelected ? t('clearSelection') : t('selectAll')} arrow>
        <Box component="label" sx={{ display: 'flex', alignItems: 'center', cursor: deletingSelection ? 'default' : 'pointer', userSelect: 'none' }}>
        <Checkbox data-testid="pdf-select-all" inputProps={{ 'aria-label': allFilesSelected ? t('clearSelection') : t('selectAll') }} checked={allFilesSelected} onChange={handleSelectAll} disabled={deletingSelection} size="small"/>
        <Typography data-testid="folder-document-count" variant="body2" color="text.secondary" sx={{ mx: 0.75, whiteSpace: 'nowrap' }}>{t('pdfCount', { count: files.length })}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ pr: 0.5, whiteSpace: 'nowrap' }}>
        {allFilesSelected ? t('clearSelection') : t('selectAll')}
        </Typography>
        </Box>
        </Tooltip>
        {selectedFiles.size > 0 && (<Typography data-testid="selected-document-count" variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', mx: .5 }}>{t('selectedCount', { count: selectedFiles.size })}</Typography>)}
        {allFilesSelected && <Button data-testid="bulk-manual-tag-management" size="small" disabled={tagMutation !== null || deletingSelection || moving} onClick={() => setBulkManualDocuments(files.filter(file => selectedFiles.has(selectionKey(file))).map(file => ({ folder: folderName, filename: file.name, driveFileId: file.driveFileId })))} sx={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>{t('manageTags')}</Button>}
        <SelectedDocumentActions documents={files.filter((file) => selectedFiles.has(selectionKey(file))).map((file) => ({ folder: folderName, filename: file.name, driveFileId: file.driveFileId }))} disabled={deletingSelection || moving} onDelete={handleDeleteSelection} onError={setError} onMoved={(moved) => setSelectedFiles((current) => new Set([...current].filter((key) => !files.some((file) => selectionKey(file) === key && moved.some((document) => fileIdentity(document.filename, document.driveFileId) === fileIdentity(file.name, file.driveFileId))))))}/>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5, flexWrap: 'wrap', ml: 'auto' }}>
        <Box data-testid="ai-tag-toolbar" sx={{ display: 'flex', flexDirection: { xs: 'column-reverse', sm: 'row' }, alignItems: { xs: 'flex-end', sm: 'center' }, gap: { xs: .5, sm: 1.5 } }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: .25 }}>
        {!canUseAiAutoTag && bulkTagLimit !== null && <Typography data-testid="ai-trial-remaining" variant="caption" color="text.secondary" aria-live="polite" sx={{ whiteSpace: 'nowrap' }}>{aiTrialExhausted ? ui('무료 AI 태그 문서 10/10개 · 추가 가능 0개') : ui('무료 AI 태그 문서 {p0}/10개 · {p1}개 추가 가능', { p0: String(10 - bulkTagLimit), p1: String(bulkTagLimit) })}</Typography>}
        {!canUseAiAutoTag && aiTrialExhausted && <Typography data-testid="ai-slots-release-guide" variant="caption" color="text.secondary">{ui("AI 태그를 제거하면 다른 문서에 적용할 수 있습니다.")}</Typography>}
        </Box>
        {aiSelectionOverLimit && !aiTrialExhausted && <Typography data-testid="ai-selection-limit" variant="caption" color="error" role="status">{ui('현재 {p0}개 문서를 추가할 수 있습니다. 선택을 줄여주세요.', { p0: String(bulkTagLimit) })}</Typography>}
        <Button data-testid="ai-auto-tag-all" variant="outlined" size="small" startIcon={bulkAutoTagProgress ? (bulkAutoTagCancelling ? <CircularProgress color="inherit" size={16}/> : <CancelOutlinedIcon />) : <AutoAwesomeIcon />} disabled={bulkAutoTagProgress ? bulkAutoTagCancelling : !aiTrialExhausted && (!canUseAiBulkTag || !tagsLoaded || (canUseAiAutoTag && bulkAutoTagTargets.length === 0) || aiSelectionOverLimit || tagMutation !== null || deletingSelection)} title={bulkAutoTagProgress ? t('aiCancelTagging') : !canUseAiAutoTag && !aiTrialExhausted && bulkAutoTagTargets.length === 0 ? ui("AI 태그를 적용할 문서를 선택하세요.") : bulkTagActionLabel} onClick={async () => {
                if (bulkAutoTagProgress)
                    handleCancelAutoTagAll();
                else if (aiTrialExhausted)
                    navigate('/pricing');
                else if (!canUseAiAutoTag && bulkAutoTagTargets.length === 0) {
                    setTagNotice({ message: ui('AI 태그를 적용할 문서를 선택해 주세요.'), severity: 'info' });
                }
                else {
                    await onAiTagProcessed?.(0);
                    setConfirmAutoTagAll(true);
                }
            }} sx={{ minHeight: 32, color: aiAccentColor, borderColor: aiAccentColor, fontWeight: 700, '&:hover': { color: aiAccentContrast, bgcolor: aiAccentColor, borderColor: aiAccentColor }, '&.Mui-disabled': { color: 'text.disabled', borderColor: 'divider' }, }}>
        {bulkAutoTagProgress ? t(bulkAutoTagCancelling ? 'aiCancellingTagging' : 'aiCancelTagging') : bulkTagActionLabel}
        </Button>
        </Box>
        <ToggleButtonGroup exclusive size="small" value={libraryView} onChange={(_, value: 'list' | 'covers' | null) => {
                if (!value)
                    return;
                setLibraryView(value);
                window.localStorage.setItem('pdfit.library.view', value);
            }} aria-label={libraryView === 'list' ? t('listView') : t('coverView')} sx={{ ml: 1.5, p: 0.25, flexShrink: 0, borderRadius: 1.25, bgcolor: 'action.hover', '& .MuiToggleButton-root': { px: 1, border: 0, borderRadius: 1, color: 'text.secondary' }, '& .Mui-selected': { bgcolor: 'rgba(148, 163, 184, 0.18)', color: 'text.primary' }, }}>
        <ToggleButton value="list" aria-label={t('listView')}>
        <Tooltip title={t('listView')} arrow><Box component="span" sx={{ display: 'flex' }}><ViewListIcon fontSize="small"/></Box></Tooltip>
        </ToggleButton>
        <ToggleButton value="covers" aria-label={t('coverView')}>
        <Tooltip title={t('coverView')} arrow><Box component="span" sx={{ display: 'flex' }}><GridViewIcon fontSize="small"/></Box></Tooltip>
        </ToggleButton>
        </ToggleButtonGroup>
        </Box>
        </Box>)}
    {bulkAutoTagProgress && (<Box data-testid="ai-bulk-tag-status" role="status" aria-live="polite" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 1, px: 1.5, py: 1.15, border: '1px solid', borderColor: aiAccentColor, borderRadius: 1, bgcolor: 'action.hover', color: 'text.primary', }}>
    <AutoAwesomeIcon sx={{ color: aiAccentColor, fontSize: 20, flexShrink: 0 }}/>
    <Typography variant="body2" fontWeight={650} sx={{ minWidth: 0 }}>
    {bulkAutoTagCancelling ? t('aiTaggingCancellationPending') : t('aiTaggingAllInProgress', { total: bulkAutoTagProgress.total })}
    </Typography>
    <LinearProgress sx={{ width: { xs: 72, sm: 160 }, height: 4, ml: 'auto', flexShrink: 0, borderRadius: 99, bgcolor: 'action.selected', '& .MuiLinearProgress-bar': { bgcolor: aiAccentColor }, }}/>
    </Box>)}
    {uploading && (<Box sx={{ mt: 2 }}>
    <LinearProgress variant="determinate" value={uploadProgress}/>
    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
    {uploadPhase === 'uploading' ? t('transferringFiles') : uploadPhase === 'indexing' ? t('indexingMetadata') : t('refreshingList')}
    {uploadProgress}%            </Typography>
    </Box>)}
    {files.length > 0 && visibleFiles.length > 0 && libraryView === 'list' && <PdfListHeader compactTagActions={!canUseAiAutoTag} />}
    </LibraryFixedControls>
    {(loadError ?? error) && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{loadError ?? error}</Alert>}
    {/* PDF 목록 */}
    <Box>
        {files.length === 0 ? (<Box sx={{ py: 6, textAlign: 'center' }}>
        <DescriptionOutlinedIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }}/>
        <Typography color="text.secondary">{t('noPdfs')}</Typography>
        <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>
        {t('uploadEmptyHint')}
        </Typography>
        <Button startIcon={<UploadFileIcon />} onClick={() => fileInputRef.current?.click()} sx={{ mt: 2 }}>
        {t('upload')}
        </Button>
        </Box>) : visibleFiles.length === 0 ? (<Box data-testid="pdf-search-empty" sx={{ py: 8, textAlign: 'center' }}>
        <FindInPageOutlinedIcon sx={{ fontSize: 44, color: 'text.disabled', mb: 1 }}/>
        <Typography color="text.secondary">{t('noPdfSearchResults')}</Typography>
        <Button startIcon={<ClearIcon />} onClick={() => setPdfSearch('')} sx={{ mt: 1.5 }}>
        {t('clearPdfSearch')}
        </Button>
        </Box>) : libraryView === 'list' ? (<>
        <List disablePadding>
        {visibleFiles.map((file) => { const identity = selectionKey(file); return (<PdfListItem compactTagActions={!canUseAiAutoTag} key={identity} filename={file.name} href={`/viewer/${encodeURIComponent(folderName)}/${encodeURIComponent(file.name)}${file.driveFileId ? `?driveFileId=${encodeURIComponent(file.driveFileId)}` : ''}`} folder={folderName} driveFileId={file.driveFileId} size={file.size} modifiedAt={file.modifiedAt} tags={fileTags[fileIdentity(file.name, file.driveFileId)] ?? fileTags[file.name] ?? []} tagColors={tagColors} onTagDelete={(rowFolder, filename, tag) => handleInlineRemoveTag(rowFolder, filename, tag, file.driveFileId)} onManageTags={(rowFolder, filename) => openTagDialog(rowFolder, filename, file.driveFileId)} onAutoTag={canUseAiAutoTag ? (_rowFolder, filename) => void handleAutoTag(filename, file.driveFileId) : undefined} onEditMetadata={bookMetadataEnabled && !isPendingUploadDriveFileId(file.driveFileId) ? () => void openDocumentMetadata(file) : undefined} autoTagLabel={canUseAiAutoTag ? t('aiAutoTag') : t('aiAutoTagPaidOnly')} autoTagging={tagMutation === `__ai_auto_tag__:${file.name}`} autoTagDisabled={!canUseAiAutoTag || (tagMutation !== null && tagMutation !== `__ai_auto_tag__:${file.name}`)} manageTagsLabel={t('manageTags')} moveLabel={t('moveToFolder')} deleteLabel={t('delete')} selected={selectedFiles.has(identity)} onSelectionChange={(_rowFolder, _filename, selected) => handleSelectionChange(identity, selected)}/>); })}
        </List>
        </>) : (<Box data-testid="pdf-cover-grid" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 2, px: 1, py: 1.5 }}>
            {visibleFiles.map((file) => {
                const identity = selectionKey(file);
                return (<PdfCoverItem key={identity} filename={file.name} url={foldersApi.fileUrl(folderName, file.name, file.driveFileId)} serverCover={serverThumbnails} thumbnailUrl={(() => {
                        if (serverThumbnails && !file.driveFileId)
                            return foldersApi.localThumbnailUrl(folderName, file.name, file.modifiedAt, file.size);
                        const thumbnail = serverThumbnails ? foldersApi.thumbnailUrl(file.driveFileId, file.modifiedAt, file.size) : foldersApi.thumbnailUrl(file.driveFileId);
                        const version = file.driveFileId ? coverVersions[file.driveFileId] : undefined;
                        if (!thumbnail || !version)
                            return thumbnail;
                        return `${thumbnail}${thumbnail.includes('?') ? '&' : '?'}cover=${version}`;
                    })()} folder={folderName} driveFileId={file.driveFileId} size={file.size} modifiedAt={file.modifiedAt} tags={fileTags[fileIdentity(file.name, file.driveFileId)] ?? fileTags[file.name] ?? []} tagColors={tagColors} selected={selectedFiles.has(identity)} autoTagging={tagMutation === `__ai_auto_tag__:${file.name}`} autoTagDisabled={!canUseAiAutoTag || (tagMutation !== null && tagMutation !== `__ai_auto_tag__:${file.name}`)} onSelectionChange={(_rowFolder, _filename, selected) => handleSelectionChange(identity, selected)} onTagDelete={(rowFolder, filename, tag) => handleInlineRemoveTag(rowFolder, filename, tag, file.driveFileId)} onManageTags={(rowFolder, filename) => openTagDialog(rowFolder, filename, file.driveFileId)} onAutoTag={canUseAiAutoTag ? (_rowFolder, filename) => void handleAutoTag(filename, file.driveFileId) : undefined} onEditMetadata={bookMetadataEnabled && !isPendingUploadDriveFileId(file.driveFileId) ? () => void openDocumentMetadata(file) : undefined} onCoverVisible={bookMetadataEnabled ? (driveFileId) => queueAutomaticCoverLookup(driveFileId, () => setCoverVersions((current) => ({ ...current, [driveFileId]: Date.now() }))) : undefined} onMove={(rowFolder, filename) => openMoveDialog(rowFolder, filename, file.driveFileId)} onDelete={(rowFolder, filename) => handleDelete(rowFolder, filename, file.driveFileId)}/>);
            })}
        </Box>)}
    </Box>
    <BookMetadataDialog target={metadataTarget} onClose={() => setMetadataTarget(null)} onCoverChanged={(driveFileId) => setCoverVersions((current) => ({ ...current, [driveFileId]: Date.now() }))} canUseAiResearch={bookResearchAccess?.() ?? false} onUpgrade={() => { setMetadataTarget(null); navigate('/pricing'); }}/>
    {/* 숨겨진 파일 input */}
    <input ref={fileInputRef} type="file" accept=".pdf" multiple hidden onChange={handleUpload}/>
    {/* 파일 이동 다이얼로그 */}
    <Dialog open={!!moveDialog} onClose={() => setMoveDialog(null)} maxWidth="xs" fullWidth>
    <DialogTitle>{t('moveToFolder')}</DialogTitle>
    <DialogContent>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
    {t('chooseMoveFolder')}
    <Box component="span" data-testid="move-document-filename" sx={{ display: 'block', mt: .75, overflowWrap: 'anywhere' }}>{ui("파일명")} : <Box component="span" translate="no">{moveDialog?.file}</Box></Box>
    </Typography>
    <FolderDestinationPicker folders={allFolders} value={moveTarget} onChange={setMoveTarget} disabled={moving}/>
    </DialogContent>
    <DialogActions>
    <Button onClick={() => setMoveDialog(null)} disabled={moving}>{t('cancel')}</Button>
    <Button variant="contained" onClick={handleMove} disabled={!moveTarget || moving}>
    {moving ? t('moving') : t('move')}
    </Button>
    </DialogActions>
    </Dialog>
    <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
    <DialogTitle>{t('deleteConfirmation')}</DialogTitle>
    <DialogContent>
    <Typography>
    {confirmDelete?.kind === 'folder' ? t('deleteFolderQuestion', { name: confirmDelete.name }) : confirmDelete?.kind === 'selection' ? t('deleteSelectedPdfsQuestion', { count: confirmDelete.files.length }) : t('deletePdfQuestion', { name: confirmDelete?.name ?? '' })}
    </Typography>
    </DialogContent>
    <DialogActions>
    <Button color="error" onClick={() => setConfirmDelete(null)}>{t('cancel')}</Button>
    <Button color="error" variant="contained" sx={{ bgcolor: "error.dark", "&:hover": { bgcolor: "error.main" } }} onClick={() => void confirmDeleteItem()}>{t('delete')}</Button>
    </DialogActions>
    </Dialog>
    <Dialog open={canUseAiBulkTag && confirmAutoTagAll} onClose={() => setConfirmAutoTagAll(false)} maxWidth="sm" fullWidth>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <AutoAwesomeIcon sx={{ color: aiAccentColor }}/>
    {bulkTagActionLabel}
    </DialogTitle>
    <DialogContent>
    <Typography sx={language === 'ko' ? { whiteSpace: { sm: 'nowrap' } } : undefined}>
    {canUseAiAutoTag ? t('aiAutoTagAllQuestion', { count: bulkAutoTagTargets.length }) : ui('선택한 문서 {p0}개에 AI 태그를 적용할까요?', { p0: String(bulkAutoTagTargets.length) })}
    </Typography>
    {!canUseAiAutoTag && bulkTagLimit !== null && <Box sx={{ mt: 1 }}>
    <Typography data-testid="ai-trial-current" variant="body2" color="text.secondary">{ui('현재 AI 태그 문서 {p0}/10개', { p0: String(10 - bulkTagLimit) })}</Typography>
    <Typography data-testid="ai-trial-after-run" variant="caption" color="text.secondary">{ui('무료 AI 태그는 최대 10개 문서에 적용할 수 있습니다.')}<br />{ui('AI 태그를 제거하면 다른 문서에 사용할 수 있습니다.')}</Typography>
    </Box>}
    {!canUseAiAutoTag && (<Box data-testid="ai-auto-tag-upgrade-guide" sx={{ mt: 2, px: 1.5, py: 1.25, display: 'flex', alignItems: 'center', gap: 1, borderRadius: 1, bgcolor: theme.palette.mode === 'light' ? '#edf4ff' : '#203149', color: theme.palette.mode === 'light' ? '#2457a6' : '#b8d5ff', borderLeft: '3px solid #3b82f6' }}>
    <AutoAwesomeIcon sx={{ fontSize: 18, flexShrink: 0 }}/>
    <Typography variant="body2" sx={{ fontSize: 13, lineHeight: 1.5 }}>{ui('무료 AI 태그 문서 최대 10개 · 유료 이용권은 더 많은 문서를 처리할 수 있습니다.')}</Typography>
    </Box>)}
    </DialogContent>
    <DialogActions>
    <Button onClick={() => setConfirmAutoTagAll(false)}>{t('cancel')}</Button>
    <Button variant="contained" startIcon={<AutoAwesomeIcon />} onClick={() => { setConfirmAutoTagAll(false); void handleAutoTagAll(); }} sx={{ color: aiAccentContrast, bgcolor: aiAccentColor, '&:hover': { bgcolor: aiAccentHover } }}>
    {bulkTagActionLabel}
    </Button>
    </DialogActions>
    </Dialog>
    <Dialog open={confirmClearFolderTags} onClose={() => setConfirmClearFolderTags(false)} maxWidth="sm" fullWidth>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <LocalOfferIcon sx={{ color: aiAccentColor }}/>
    {t('clearFolderTags')}
    </DialogTitle>
    <DialogContent>
    <Typography sx={{ whiteSpace: { sm: 'nowrap' } }}>{t('clearFolderTagsQuestionPrimary', { bookCount: taggedBookCount, tagCount: folderTagRelations.length })}</Typography>
    <Typography color="text.secondary" sx={{ mt: 0.5 }}>{t('clearFolderTagsQuestionSecondary')}</Typography>
    </DialogContent>
    <DialogActions>
    <Button onClick={() => setConfirmClearFolderTags(false)}>{t('cancel')}</Button>
    <Button variant="contained" startIcon={<LocalOfferIcon />} onClick={() => { setConfirmClearFolderTags(false); void handleClearFolderTags(); }} sx={{ color: aiAccentContrast, bgcolor: aiAccentColor, '&:hover': { bgcolor: aiAccentHover } }}>
    {t('clearFolderTagsAction')}
    </Button>
    </DialogActions>
    </Dialog>
    {/* 태그 관리 다이얼로그 */}
    <Dialog open={!!tagDialog} disableAutoFocus onClose={() => void handleCloseTagDialog()} maxWidth="xs" fullWidth>
    <DialogTitle sx={{ pb: 1 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <HashTagIcon color="primary" fontSize="small"/>
    {t('manageTags')}
    </Box>
    </DialogTitle>
    <DialogContent>
        {tagLoading ? (<Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={24}/>
        </Box>) : (<>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {ui("파일명 :")}{' '}<Box component="span" translate="no">{tagDialog?.file}</Box>
        </Typography>
        {/* 현재 태그 목록 */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2, minHeight: 32 }}>
        {tagDialog?.currentTags.length === 0 ? (<Typography variant="caption" color="text.disabled">{t('noTags')}</Typography>) : (tagDialog?.currentTags.map((tag) => (<TagChip hashLabel key={tag} tag={tag} color={tagColors[tag]} disabled={tagMutation !== null} onDelete={() => void handleRemoveTag(tag)}/>)))}
        </Box>
        {/* 태그 추가 (자동완성 + 자유입력) */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Autocomplete freeSolo onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
                    return;
                event.preventDefault();
                (event as typeof event & {
                    defaultMuiPrevented?: boolean;
                }).defaultMuiPrevented = true;
                const input = (event.target as HTMLInputElement).value ?? tagInput;
                if (input.trim())
                    void handleAddTag(input);
            }} fullWidth value={null} disabled={tagMutation !== null} options={allTags.filter((t) => !tagDialog?.currentTags.includes(t))} inputValue={tagInput} onInputChange={(_e, val, reason) => {
                if (reason === 'input' || reason === 'clear')
                    setTagInput(val);
            }} onChange={(_e, val) => {
                if (val)
                    void handleAddTag(val);
            }} renderInput={(params) => (<TextField {...params} label={t('addTag')} InputLabelProps={{ shrink: true }} inputProps={{ ...params.inputProps, 'aria-label': t('addTag') }} size="small" placeholder={t('addTagPlaceholder')} sx={{ '& .MuiOutlinedInput-root fieldset': { borderColor: 'text.secondary' }, '& .MuiInputLabel-root': { color: 'text.secondary' }, '& input::placeholder': { color: 'text.secondary', opacity: 1 }, '&:hover .MuiOutlinedInput-root:not(.Mui-disabled) fieldset, & .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: '#3b82f6' }, '&:hover .MuiInputLabel-root:not(.Mui-disabled), & .MuiInputLabel-root.Mui-focused': { color: '#3b82f6' } }}/>)}/>
        <TagColorPicker color={tagInputColor} onChange={(color) => { setTagInputColor(color); rememberTagInputColor(color); }} label={ui("새 태그 색상")} variant="swatch"/>
        <Button data-testid="add-tag-button" variant="contained" size="small" disabled={tagMutation !== null} onClick={(event) => {
                if (tagInput.trim())
                    void handleAddTag(tagInput);
                else
                    event.currentTarget.parentElement?.querySelector('input')?.focus();
            }} sx={{ flexShrink: 0, bgcolor: '#3b82f6', color: '#ffffff', '&:hover': { bgcolor: '#2563eb' } }}>{ui("추가")}</Button>
        </Box>
        {!canUseAiAutoTag && <Typography data-testid="pdf-auto-classify-access-guide" variant="body2" color="text.secondary" sx={{ mt: 2, fontSize: 14, lineHeight: 1.6 }}>{ui('유료 이용권 결제 시 AI 자동태그를 사용할 수 있습니다.')}</Typography>}
        </>)}
    </DialogContent>
    <DialogActions sx={{ justifyContent: canUseAiAutoTag ? 'space-between' : 'flex-end' }}>
    {canUseAiAutoTag && <Box sx={{ minWidth: 0 }}>
    <Button startIcon={tagMutation?.startsWith('__ai_auto_tag__:') ? <CircularProgress size={16}/> : <AutoAwesomeIcon />} disabled={!canUseAiAutoTag || tagLoading || tagMutation !== null} title={!canUseAiAutoTag ? t('aiAutoTagPaidOnly') : t('aiAutoTag')} onClick={() => void handleAutoTag()} sx={{ color: aiAccentColor, '&:hover': { bgcolor: `${aiAccentColor}1f` } }}>
    {tagMutation?.startsWith('__ai_auto_tag__:') ? t('aiTagging') : t('aiAutoTag')}
    </Button>
    </Box>}
    <Button disabled={tagMutation !== null} onClick={() => void handleCloseTagDialog()}>{t('close')}</Button>
    </DialogActions>
    </Dialog>
    <BulkManualTagDialog documents={bulkManualDocuments} onClose={() => setBulkManualDocuments(null)} onAdded={(document, tag, color) => {
            folderModel.addTag(document.filename, tag, document.driveFileId);
            if (color)
                setTagColors(current => ({ ...current, [tag]: color }));
        }}/>
    <TagNoticeSnackbar notice={tagNotice} onClose={() => setTagNotice(null)}/>
    </Box>);
}
export default React.memo(FolderPage);
