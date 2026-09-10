<script lang="ts">
    import { Input } from "$lib/components/ui/input";
    import DirtyInput from "$lib/components/common/DirtyInput.svelte";
    import { Button } from "$lib/components/ui/button";
    import { Label } from "$lib/components/ui/label";
    import { Plus, Search, Download, FileDown, FileUp, MoreHorizontal, Bot, Sparkles, Loader2, Lightbulb, WandSparkles, X } from "lucide-svelte";
    import { toast } from "svelte-sonner";
    import { AiService } from "$lib/ai/service";
    import { countBrokenUnicode } from "$lib/ai/worldInfoParser";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Textarea } from "$lib/components/ui/textarea";
    import { Checkbox } from "$lib/components/ui/checkbox";
    import WorldInfoEntry from "./WorldInfoEntry.svelte";
    import { cn } from "$lib/utils";
    import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
    import ImportWorldInfoDialog from "./ImportWorldInfoDialog.svelte";
    import ExportWorldInfoDialog from "./ExportWorldInfoDialog.svelte";
    import { type CharacterBookEntry } from "$lib/worldInfoConverter";
    import { untrack } from "svelte";
    import { dndzone, TRIGGERS } from "svelte-dnd-action";
    import { flip } from "svelte/animate";
    import { downloadFile } from "$lib/utils/download";

    import DirtyLabel from "$lib/components/common/DirtyLabel.svelte";

    type CharacterGenerationContext = {
        name?: string;
        description?: string;
        personality?: string;
        scenario?: string;
        firstMessage?: string;
        messageExample?: string;
        creatorNotes?: string;
    };

    const FLIP_DURATION_MS = 200;
    const TOUCH_DELAY_MS = 400; // 长按 400ms 后才能拖拽

    // 拖拽专用状态（防止拖拽过程中触发脏状态）
    let dndItems: any[] = $state([]);
    let isDragging = $state(false);
    
    // Explicit Drag Handle Control
    let isDragEnabled = $state(false); // Default to disabled

    let openEntries: Record<number, boolean> = $state({});

    // 当任意条目展开时禁用拖拽
    let isDragDisabled = $derived(openEntries && Object.values(openEntries).some(v => v));


    let {
        data = $bindable({ character_book: { entries: [] }, extensions: {} }),
        lastSaved = 0,
        onChange = () => {},
        mode = "character", // "character" | "global"
        name = $bindable(), // For Global Mode (DB Name)
        source = "local",
        characterContext,
    } = $props<{
        data?: any,
        lastSaved?: number,
        onChange?: () => void,
        mode?: "character" | "global",
        name?: string,
        source?: string,
        characterContext?: CharacterGenerationContext,
    }>();

    // Ensure structure exists
    $effect(() => {
        if (!data.character_book)
            data.character_book = { entries: [], name: "" };
        if (!data.extensions) data.extensions = {};
        if (!data.character_book.entries) {
            data.character_book.entries = mode === "global" ? {} : [];
        }
    });

    let searchTerm = $state("");

    // Dirty State Logic for World Name
    let originalName = $state("");

    // Initialize/Reset original name on load or save
    $effect(() => {
        const _ls = lastSaved; // dependency
        untrack(() => {
            if (mode === "global") {
                originalName = name || "";
            } else {
                originalName = data.extensions?.world || "";
            }
        });
    });

    let isNameDirty = $derived.by(() => {
        let current = "";
        if (mode === "global") {
            current = name || "";
        } else {
            current = data.extensions?.world || "";
        }
        return current !== originalName;
    });

    // Filtered entries (Sorted by display_index)
    let filteredEntries = $derived.by(() => {
        let entriesRaw = data?.character_book?.entries;
        if (!entriesRaw) return [];

        let entries = [];
        if (Array.isArray(entriesRaw)) {
            entries = [...entriesRaw];
        } else {
            // Object/Map (Global)
            entries = Object.values(entriesRaw);
        }

        // Ensure 'id' exists for dndzone (Global uses 'uid')
        entries = entries.map((e: any) => {
            if (e.id === undefined && e.uid !== undefined) {
                return { ...e, id: e.uid };
            }
            return e;
        });

        // Default Sort by display_index / order / insertion_order
        entries.sort((a: any, b: any) => {
            if (mode === "global") {
                const da = a.displayIndex ?? a.order ?? 9999;
                const db = b.displayIndex ?? b.order ?? 9999;
                return da - db;
            } else {
                const da = a.extensions?.display_index ?? 9999;
                const db = b.extensions?.display_index ?? 9999;
                return da - db;
            }
        });

        if (!searchTerm) return entries;

        const low = searchTerm.toLowerCase();
        return entries.filter(
            (e: any) =>
                (e.comment || "").toLowerCase().includes(low) ||
                (e.keys || e.key || []).some((k: string) =>
                    k.toLowerCase().includes(low),
                ) ||
                (e.content || "").toLowerCase().includes(low),
        );
    });

    // Import/Export State
    let importDialogOpen = $state(false);
    let exportDialogOpen = $state(false);

    function handleImportEntries(newEntries: CharacterBookEntry[]) {
        if (!data.character_book.entries) data.character_book.entries = [];
        const currentEntries = data.character_book.entries as any[];
        
        // Calculate max values to ensure append-only
        let maxId = 0;
        let maxDisplayIndex = 0;
        
        currentEntries.forEach(e => {
            const id = Number(e.id || 0);
            const display = Number(e.extensions?.display_index || 0);
            if (id > maxId) maxId = id;
            if (display > maxDisplayIndex) maxDisplayIndex = display;
        });
        
        newEntries.forEach(entry => {
             // Clone to avoid reference issues
             const newEntry = JSON.parse(JSON.stringify(entry));
             
             // Assign new unique properties
             maxId++;
             maxDisplayIndex++;
             
             newEntry.id = maxId;
             if (!newEntry.extensions) newEntry.extensions = {};
             newEntry.extensions.display_index = maxDisplayIndex;
             
             currentEntries.push(newEntry);
        });
        
        data.character_book = { ...data.character_book }; // Trigger reactivity
        if (onChange) onChange();
    }

    // Drag and Drop Logic (svelte-dnd-action)
    // 记录拖拽前的顺序，用于判断是否真正改变了位置
    let orderBeforeDrag: (number | string)[] = [];

    function handleDndConsider(e: CustomEvent<{ items: any[], info: { trigger: string } }>) {
        // 只有在拖拽真正开始时才更新 dndItems，避免轻触导致的闪烁
        if (e.detail.info.trigger === TRIGGERS.DRAG_STARTED) {
            orderBeforeDrag = filteredEntries.map((ent: any) => ent.id ?? ent.uid);
            isDragging = true;
            dndItems = e.detail.items;
        } else if (isDragging) {
            // 拖拽过程中持续更新
            dndItems = e.detail.items;
        }
        // 非拖拽状态下不更新 dndItems，避免触发重新渲染
    }

    function handleDndFinalize(e: CustomEvent<{ items: any[], info: { trigger: string } }>) {
        // 如果当前不在拖拽状态，忽略 finalize 事件
        if (!isDragging) {
            return;
        }
        
        isDragging = false;
        isDragEnabled = false; // Safety reset
        const newItems = e.detail.items;
        
        // 只有顺序真正改变时才更新数据并触发 onChange
        const newOrder = newItems.map((ent: any) => ent.id ?? ent.uid);
        const orderChanged = orderBeforeDrag.length > 0 && 
            (orderBeforeDrag.length !== newOrder.length || 
             orderBeforeDrag.some((id, i) => id !== newOrder[i]));
        
        if (orderChanged) {
            // 只有顺序改变时才同步到真实数据
            updateEntriesFromDnd(newItems);
            if (onChange) onChange();
        }
        
        dndItems = [];
        orderBeforeDrag = [];
    }

    function updateEntriesFromDnd(items: any[]) {
        // 移除 svelte-dnd-action 添加的内部属性并更新 display_index
        const cleanedItems = items.map((item, index) => {
            const { isDndShadowItem, ...cleanItem } = item;
            if (mode === "global") {
                cleanItem.displayIndex = index;
            } else {
                if (!cleanItem.extensions) cleanItem.extensions = {};
                cleanItem.extensions.display_index = index;
            }
            return cleanItem;
        });

        if (Array.isArray(data.character_book.entries)) {
            data.character_book = {
                ...data.character_book,
                entries: cleanedItems,
            };
        } else {
            const entriesMap: Record<string, any> = {};
            cleanedItems.forEach((e) => {
                const key = e.uid !== undefined ? e.uid : e.id;
                entriesMap[key] = e;
            });
            data.character_book = {
                ...data.character_book,
                entries: entriesMap,
            };
        }
    }

    // 获取用于显示的列表（拖拽中用 dndItems，否则用 filteredEntries）
    let displayEntries = $derived(isDragging ? dndItems : filteredEntries);

    function addEntry(input?: any) {
        let initialData: any = {};
        // If input is not an event, treat as data
        if (input && !input.preventDefault && !input.bubbles) {
            initialData = input;
        }
        if (!data.character_book)
            data.character_book = { entries: mode === "global" ? {} : [] };
        // Ensure type correctness
        if (mode === "global" && Array.isArray(data.character_book.entries))
            data.character_book.entries = {};
        if (mode === "character" && !Array.isArray(data.character_book.entries))
            data.character_book.entries = [];

        let currentList = [];
        if (Array.isArray(data.character_book.entries)) {
            currentList = data.character_book.entries;
        } else {
            currentList = Object.values(data.character_book.entries || {});
        }

        // Generate new ID (max + 1)
        const maxId = currentList.reduce(
            (max: number, e: any) => Math.max(max, (e.uid ?? e.id) || 0),
            0,
        );
        const newId = maxId + 1;

        let newEntry: any = {};
        if (initialData.comment) {
            // If ID present in initialData, we might overwrite? No, keep generated ID
        }
        if (mode === "global") {
            // GLOBAL SCHEMA
            newEntry = {
                uid: newId,
                key: [],
                keysecondary: [],
                comment: "（请修改）条目名称",
                content: "",
                constant: false,
                vectorized: false,
                selective: true,
                selectiveLogic: 0,
                addMemo: false,
                order: 100,
                position: 0,
                disable: false,
                ignoreBudget: false,
                excludeRecursion: false,
                preventRecursion: false,
                matchPersonaDescription: false,
                matchCharacterDescription: false,
                matchCharacterPersonality: false,
                matchCharacterDepthPrompt: false,
                matchScenario: false,
                matchCreatorNotes: false,
                delayUntilRecursion: 0,
                probability: 100,
                useProbability: true,
                depth: 4,
                outletName: "",
                group: "",
                groupOverride: false,
                groupWeight: 100,
                scanDepth: null,
                caseSensitive: null,
                matchWholeWords: null,
                useGroupScoring: null,
                automationId: "",
                role: null,
                sticky: null,
                cooldown: null,
                delay: null,
                triggers: [],
                displayIndex: currentList.length,
                characterFilter: {
                    isExclude: false,
                    names: [],
                    tags: [],
                },
            };
        } else {
            // CHARACTER SCHEMA
            newEntry = {
                id: newId,
                keys: [],
                secondary_keys: [],
                comment: "（请修改）条目名称",
                content: "",
                constant: false,
                selective: true,
                insertion_order: 100,
                enabled: true,
                position: "before_char",
                use_regex: true,
                extensions: {
                    position: 0,
                    exclude_recursion: false,
                    display_index: currentList.length,
                    probability: 100,
                    useProbability: true,
                    depth: 4,
                    selectiveLogic: 0,
                    outlet_name: "",
                    group: "",
                    group_override: false,
                    group_weight: 100,
                    prevent_recursion: false,
                    delay_until_recursion: false,
                    scan_depth: null,
                    match_whole_words: null,
                    use_group_scoring: false,
                    case_sensitive: null,
                    automation_id: "",
                    role: 0,
                    vectorized: false,
                    sticky: 0,
                    cooldown: 0,
                    delay: 0,
                    match_persona_description: false,
                    match_character_description: false,
                    match_character_personality: false,
                    match_character_depth_prompt: false,
                    match_scenario: false,
                    match_creator_notes: false,
                    triggers: [],
                    ignore_budget: false,
                },
            };
        }

        if (Object.keys(initialData).length > 0) {
             newEntry = { ...newEntry, ...initialData };
        }

        if (Array.isArray(data.character_book.entries)) {
            data.character_book.entries = [
                ...data.character_book.entries,
                newEntry,
            ];
        } else {
            // Map
            data.character_book.entries = {
                ...data.character_book.entries,
                [newId]: newEntry,
            };
        }



        // Re-write back to structure (redundant but safe)
        if (Array.isArray(data.character_book.entries)) {
             // We pushed newEntry above but we modified it locally? 
             // Wait, I need to push the MERGED entry.
             // Original code:
             // if (mode === "global") { ... newEntry = ... } else { ... newEntry = ... }
             // if array -> entries = [...entries, newEntry]
             // So I should merge BEFORE pushing.
        }

        data.character_book = { ...data.character_book }; // Trigger top level
        if (onChange) onChange();
    }

    function deleteEntry(id: number) {
        if (Array.isArray(data.character_book.entries)) {
            data.character_book = {
                ...data.character_book,
                entries: data.character_book.entries.filter(
                    (e: any) => (e.id ?? e.uid) !== id,
                ),
            };
        } else {
            const newEntries = { ...data.character_book.entries };
            delete newEntries[id]; // ID matches key in Global usually
            data.character_book = {
                ...data.character_book,
                entries: newEntries,
            };
        }
        if (onChange) onChange();
    }

    async function exportWorldBook() {
        const exportName =
            (mode === "global" ? name : data.extensions?.world) || "WorldInfo";
        const filename = `${exportName}.json`;

        // Ensure structure matches mode
        let content = "";
        if (mode === "global") {
            // For global, we usually export the whole object { entries: ... }
            // data.character_book IS the object
            content = JSON.stringify(data.character_book, null, 2);
        } else {
            // For character, we export { entries: ... } wrapped?
            // Normally export only makes sense for Global books in this context.
            // But if user wants to export embedded...
            content = JSON.stringify(data.character_book, null, 2);
        }

        await downloadFile({
            filename,
            content: content,
            type: "application/json"
        });
    }

    // AI Generation Logic
    type GenerationMode = "keywords" | "inspire";
    type GeneratedDraft = {
        comment: string;
        content: string;
        keysText: string;
        selected: boolean;
    };

    let isGenDialogOpen = $state(false);
    let genMode: GenerationMode = $state("keywords");
    let genKeywords = $state("");
    let genCount = $state(3);
    let isGenerating = $state(false);
    let generatedDrafts: GeneratedDraft[] = $state([]);
    let generatedBrokenUnicodeCount = $derived(
        generatedDrafts.reduce((total, draft) => total + getDraftBrokenUnicodeCount(draft), 0),
    );
    let selectedBrokenUnicodeCount = $derived(
        generatedDrafts
            .filter((draft) => draft.selected)
            .reduce((total, draft) => total + getDraftBrokenUnicodeCount(draft), 0),
    );
    let canGenerate = $derived(
        genMode === "keywords"
            ? Boolean(genKeywords.trim())
            : Boolean(getGenerationContext()),
    );

    function openGenerator() {
        generatedDrafts = [];
        genMode = mode === "character" && getGenerationContext() ? "inspire" : "keywords";
        isGenDialogOpen = true;
    }

    function getDraftBrokenUnicodeCount(draft: GeneratedDraft) {
        return countBrokenUnicode(draft.comment)
            + countBrokenUnicode(draft.keysText)
            + countBrokenUnicode(draft.content);
    }

    function getCurrentWorldInfo() {
        let entriesData: any[] = [];
        if (Array.isArray(data.character_book?.entries)) {
            entriesData = data.character_book.entries;
        } else {
            entriesData = Object.values(data.character_book?.entries || {});
        }

        const context = entriesData
            .filter((entry: any) => entry.enabled !== false && entry.disable !== true)
            .map((entry: any) => {
                const keys = entry.keys || entry.key || [];
                return `名称：${entry.comment || "未命名"}\n关键词：${Array.isArray(keys) ? keys.join("、") : keys}\n内容：${entry.content || ""}`;
            })
            .join("\n---\n");

        // Keep large imported books within a practical request size while retaining recent context.
        return context.length > 16000 ? context.slice(-16000) : context;
    }

    function getCharacterContext() {
        if (mode !== "character" || !characterContext) return "";

        const fields = [
            ["角色名", characterContext.name],
            ["角色描述", characterContext.description],
            ["性格", characterContext.personality],
            ["场景", characterContext.scenario],
            ["开场白", characterContext.firstMessage],
            ["对话示例", characterContext.messageExample],
            ["创作者备注", characterContext.creatorNotes],
        ]
            .filter(([, value]) => typeof value === "string" && value.trim())
            .map(([label, value]) => `${label}：${value!.trim()}`)
            .join("\n\n");

        return fields.length > 12000 ? fields.slice(0, 12000) : fields;
    }

    function getGenerationContext() {
        const character = getCharacterContext();
        const worldInfo = getCurrentWorldInfo();
        const sections = [];

        if (character) sections.push(`【角色人设表】\n${character}`);
        if (worldInfo) sections.push(`【当前世界书（已启用条目）】\n${worldInfo}`);

        return sections.join("\n\n========\n\n");
    }

    function buildGenerationRequest(count: number, hasCharacterContext: boolean, hasWorldInfo: boolean) {
        const worldName = (mode === "global" ? name : data.extensions?.world) || "未命名世界";
        if (genMode === "keywords") {
            const characterInstruction = hasCharacterContext ? "请结合角色人设表，" : "";
            return `为《${worldName}》围绕以下关键词或设定锚点生成 ${count} 条彼此有关联、可直接使用的世界书条目：${genKeywords.trim()}。${characterInstruction}不要重复当前已有条目。`;
        }

        if (mode === "character" && hasCharacterContext && !hasWorldInfo) {
            return `《${worldName}》的角色世界书目前为空。请根据角色人设表生成首批 ${count} 条最有助于稳定角色扮演的世界书条目，提炼角色相关的地点、关系、势力、规则、经历或关键物件；不要只是复述人设原文，条目之间要有关联并留下剧情钩子。`;
        }

        if (mode === "character" && hasCharacterContext) {
            return `为《${worldName}》结合角色人设表和当前世界书，补全 ${count} 条最缺失、最能稳定角色扮演并产生剧情钩子的条目。新条目应与已有设定相互引用，且不要重复人设或已有条目。`;
        }

        return `为《${worldName}》一键补全 ${count} 条当前世界观中最缺失、最能产生剧情钩子的世界书条目。新条目必须与已有设定相互引用，且不要重复已有条目。`;
    }

    async function handleGenerateWorldInfo() {
        if (genMode === "keywords" && !genKeywords.trim()) {
            toast.error("空白世界书需要先输入关键词或设定方向");
            return;
        }

        const currentWorldInfo = getCurrentWorldInfo();
        const currentCharacterContext = getCharacterContext();
        const generationContext = getGenerationContext();
        if (genMode === "inspire" && !generationContext) {
            toast.error(
                mode === "character"
                    ? "角色人设表和世界书都为空，请先填写人设或改用关键词生成"
                    : "一键补全需要至少一条已启用的世界书条目",
            );
            return;
        }

        const count = Math.min(8, Math.max(1, Math.round(Number(genCount) || 3)));
        genCount = count;
        isGenerating = true;

        try {
            const request = buildGenerationRequest(
                count,
                Boolean(currentCharacterContext),
                Boolean(currentWorldInfo),
            );
            const newEntriesData = await AiService.generateWorldInfo(
                request,
                generationContext || "（当前世界书暂无条目）",
                count,
            );

            if (newEntriesData.length > 0) {
                generatedDrafts = newEntriesData.map((item, index) => ({
                    comment: item.comment || `AI 生成条目 ${index + 1}`,
                    content: item.content || "",
                    keysText: item.keys.join("、"),
                    selected: true,
                }));
                if (generatedBrokenUnicodeCount > 0) {
                    toast.warning(
                        `生成内容有 ${generatedBrokenUnicodeCount} 处损坏字符，已标出；请修改或重新生成`,
                    );
                } else {
                    toast.success(`生成了 ${generatedDrafts.length} 条，确认后再加入世界书`);
                }
            } else {
                toast.error("AI 没有返回可用条目，请换个关键词重试");
            }
        } catch (e: any) {
            toast.error("生成失败: " + (e.message || "Unknown error"));
        } finally {
            isGenerating = false;
        }
    }

    function addGeneratedEntries() {
        const selected = generatedDrafts.filter((draft) => draft.selected);
        if (selected.length === 0) {
            toast.error("至少选择一条再加入世界书");
            return;
        }
        if (selectedBrokenUnicodeCount > 0) {
            toast.error(
                `选中的条目还有 ${selectedBrokenUnicodeCount} 处损坏字符，请修改或取消勾选后再加入`,
            );
            return;
        }

        selected.forEach((draft) => {
            const keys = draft.keysText
                .split(/[,，、\n]/)
                .map((key) => key.trim())
                .filter(Boolean);
            addEntry({
                comment: draft.comment.trim() || "AI 生成条目",
                content: draft.content.trim(),
                ...(mode === "global" ? { key: keys } : { keys }),
                constant: keys.length === 0,
            });
        });

        toast.success(`已加入 ${selected.length} 条，记得保存世界书`);
        isGenDialogOpen = false;
        generatedDrafts = [];
        genKeywords = "";
    }

</script>

<div
    class="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10"
>
    <!-- Entries Toolbar -->
    <div class="flex flex-wrap items-center gap-4">
        <div class="relative flex-1 ml-1 border border-1 rounded-md">
            <Search
                class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            />
            <Input
                placeholder="搜索条目..."
                bind:value={searchTerm}
                class="pl-9 bg-background/50 border-border/40"
            />
        </div>
        <div class="flex items-center gap-2">
            {#if mode === "character"}
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger class="inline-flex items-center justify-center rounded-md text-sm font-medium whitespace-nowrap ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 w-9 border border-input shadow-sm">
                        <MoreHorizontal class="h-4 w-4" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="start">
                        <DropdownMenu.Item onclick={() => importDialogOpen = true}>
                            <FileDown class="mr-2 h-4 w-4" />
                            从全局世界书导入...
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onclick={() => exportDialogOpen = true}>
                            <FileUp class="mr-2 h-4 w-4" />
                            导出到全局世界书...
                        </DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Root>
            {/if}
            {#if source === "local"}
                <Button
                    onclick={openGenerator}
                    class="gap-2 border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10"
                    variant="outline"
                >
                    <WandSparkles class="h-4 w-4 text-primary" /> AI 生成
                </Button>
            {/if}
            <Button
                onclick={addEntry}
                class="gap-2 border-primary bg-background text-foreground hover:bg-primary/10"
                variant="outline"
            >
                <Plus class="h-4 w-4" /> 添加条目
            </Button>
            {#if mode === "global"}
                 <Button
                    onclick={exportWorldBook}
                    class="gap-2 border-primary/20 bg-background text-foreground hover:bg-primary/10 ml-2"
                    variant="outline"
                >
                    <Download class="h-4 w-4" /> 导出 JSON
                </Button>           
            {/if}
        </div>


    </div>
    <!-- Global Settings -->
    <div
        class="space-y-4 p-4 rounded-xl border border-border/40 bg-card/50 shadow-sm"
    >
        <div class="space-y-2">
            <DirtyLabel
                isDirty={isNameDirty}
                class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >世界书名称</DirtyLabel
            >
            {#if mode === "global"}
                <DirtyInput
                    bind:value={name}
                    isDirty={isNameDirty}
                    placeholder="世界书名称..."
                    class="border-1 bg-secondary/20 h-10 text-lg font-medium focus-visible:ring-1 focus-visible:bg-background transition-all shadow-none"
                    oninput={() => onChange && onChange()}
                />
            {:else if data.extensions}
                <DirtyInput
                    value={data.extensions.world}
                    isDirty={isNameDirty}
                    placeholder="给世界书起个名字..."
                    class="border-1 bg-secondary/20 h-10 text-lg font-medium focus-visible:ring-1 focus-visible:bg-background transition-all shadow-none"
                    oninput={(e) => {
                        const val = e.currentTarget.value;
                        data.extensions.world = val;
                        // 确保 character_book 结构存在
                        if (!data.character_book) {
                            data.character_book = { entries: [], name: val };
                        } else {
                            data.character_book.name = val;
                        }
                        if (onChange) onChange();
                    }}
                />
            {:else}
                <div class="text-sm text-red-500">
                    Extensions struct missing
                </div>
            {/if}
        </div>
    </div>

    <!-- Entries List -->
    <div class="space-y-4 min-h-[300px] p-4">
        {#if filteredEntries.length === 0}
            <div
                class="text-center py-20 text-muted-foreground border border-dashed rounded-xl"
            >
                {#if searchTerm}
                    没找到匹配的条目
                {:else}
                    暂无世界书条目，点击右上角添加
                {/if}
            </div>
        {:else if searchTerm}
            <!-- 搜索模式：禁用拖拽 -->
            {#each filteredEntries as entry (entry.id || entry.uid)}
                <div class="transition-all duration-200 relative" class:z-20={openEntries[entry.id || entry.uid]}>
                    <WorldInfoEntry
                        {entry}
                        {lastSaved}
                        isOpen={openEntries[entry.id || entry.uid] ?? false}
                        onToggle={() => openEntries[entry.id || entry.uid] = !openEntries[entry.id || entry.uid]}
                        onDelete={(id) => deleteEntry(id)}
                        {onChange}
                        onUpdate={(mutator: (e: any) => void) => {
                            // 1. Mutate the visual copy (for immediate feedback)
                            mutator(entry);

                            // 2. Mutate the source of truth
                            const targetId = entry.id ?? entry.uid;
                            if (Array.isArray(data.character_book.entries)) {
                                const realEntry = data.character_book.entries.find((e: any) => (e.id ?? e.uid) === targetId);
                                if (realEntry) mutator(realEntry);
                            } else {
                                // Map (Global)
                                if (data.character_book.entries[targetId]) {
                                    mutator(data.character_book.entries[targetId]);
                                }
                            }
                            
                            // 3. Trigger Svelte Reactivity
                            data.character_book = data.character_book;

                            if (onChange) onChange();
                        }}
                        {mode}
                    />
                </div>
            {/each}
        {:else}
            <!-- 正常模式：启用拖拽 -->
            <div
                use:dndzone={{
                    items: displayEntries,
                    flipDurationMs: FLIP_DURATION_MS,
                    delayTouchStart: TOUCH_DELAY_MS,
                    dragDisabled: isDragDisabled,
                    dropTargetStyle: {},
                    type: 'world-info-entries'
                }}
                onconsider={handleDndConsider}
                onfinalize={handleDndFinalize}
                class="space-y-4"
            >
                {#each displayEntries as entry (entry.id || entry.uid)}
                    <div
                        animate:flip={{ duration: FLIP_DURATION_MS }}
                        class={cn(
                            "transition-all duration-200 relative",
                            entry.isDndShadowItem && "h-16 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5",
                            !entry.isDndShadowItem && openEntries[entry.id || entry.uid] ? "z-20" : "z-0 hover:!z-50"
                        )}
                    >
                        {#if !entry.isDndShadowItem}
                            <WorldInfoEntry
                                {entry}
                                {lastSaved}
                                isOpen={openEntries[entry.id || entry.uid] ?? false}
                                onToggle={() => openEntries[entry.id || entry.uid] = !openEntries[entry.id || entry.uid]}
                                onDelete={(id) => deleteEntry(id)}
                                {onChange}
                                onUpdate={(mutator: (e: any) => void) => {
                                    mutator(entry);
                                    
                                    const targetId = entry.id ?? entry.uid;
                                    if (Array.isArray(data.character_book.entries)) {
                                        const realEntry = data.character_book.entries.find((e: any) => (e.id ?? e.uid) === targetId);
                                        if (realEntry) mutator(realEntry);
                                    } else {
                                        if (data.character_book.entries[targetId]) {
                                            mutator(data.character_book.entries[targetId]);
                                        }
                                    }

                                    data.character_book = data.character_book;
                                    if (onChange) onChange();
                                }}
                                {mode}
                                onDragStart={() => isDragEnabled = true}
                                onDragEnd={() => isDragEnabled = false}
                            />
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>

    <ImportWorldInfoDialog 
        bind:open={importDialogOpen} 
        onImport={handleImportEntries} 
    />
    
    <ExportWorldInfoDialog 
        bind:open={exportDialogOpen}
        entries={Array.isArray(data.character_book.entries) ? data.character_book.entries : Object.values(data.character_book.entries)}
    />

    <Dialog.Root bind:open={isGenDialogOpen}>
        <Dialog.Content class="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
            <Dialog.Header>
                <Dialog.Title class="flex items-center gap-2">
                    <Bot class="h-5 w-5 text-primary" />
                    AI 世界书生成
                </Dialog.Title>
                <Dialog.Description>
                    {#if mode === "character"}
                        空白时可根据角色人设表生成；已有条目后会结合两者继续补全。
                    {:else}
                        用关键词定向创作，或根据当前已有条目智能补全。
                    {/if}
                </Dialog.Description>
                <div class="text-xs text-muted-foreground mt-1">
                    {#if mode === "character"}
                        会读取当前人设表字段和已启用的世界书条目，不会读取聊天记录。
                    {:else}
                        只读取当前已启用的世界书条目，不会读取其他世界书。
                    {/if}
                </div>
                <div class="text-xs text-muted-foreground mt-1">
                    生成结果会先进入预览，确认加入后才会改动世界书。
                </div>
            </Dialog.Header>

            <div class="space-y-5 py-4">
                <div class="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-1">
                    <Button
                        type="button"
                        variant={genMode === "keywords" ? "default" : "ghost"}
                        class="gap-2"
                        onclick={() => { genMode = "keywords"; generatedDrafts = []; }}
                    >
                        <Sparkles class="h-4 w-4" /> 关键词生成
                    </Button>
                    <Button
                        type="button"
                        variant={genMode === "inspire" ? "default" : "ghost"}
                        class="gap-2"
                        onclick={() => { genMode = "inspire"; generatedDrafts = []; }}
                    >
                        <Lightbulb class="h-4 w-4" />
                        {mode === "character" ? "根据人设生成" : "智能补全"}
                    </Button>
                </div>

                {#if genMode === "keywords"}
                    <div class="space-y-2">
                        <Label for="world-info-keywords">关键词 / 设定锚点</Label>
                        <Textarea
                            id="world-info-keywords"
                            bind:value={genKeywords}
                            placeholder="例如：海上城邦、禁忌潮汐、以记忆缴税、失踪的灯塔守卫"
                            rows={3}
                        />
                        <p class="text-xs text-muted-foreground">
                            可只写几个词，也可以补充时代、风格和不想出现的内容。
                        </p>
                    </div>
                {:else}
                    <div
                        class={cn(
                            "rounded-lg border border-dashed p-4 text-sm",
                            getGenerationContext()
                                ? "bg-muted/20 text-muted-foreground"
                                : "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300",
                        )}
                    >
                        {#if mode === "character" && getCharacterContext() && !getCurrentWorldInfo()}
                            当前世界书为空，将根据角色名、描述、性格、场景、开场白、对话示例和创作者备注生成首批条目。
                        {:else if mode === "character" && getCharacterContext() && getCurrentWorldInfo()}
                            AI 会结合当前人设表和已启用的世界书条目，补充缺失设定。
                        {:else if getCurrentWorldInfo()}
                            AI 会阅读当前已启用的条目，挑出设定缺口并补充彼此关联的新条目。
                        {:else if mode === "character"}
                            角色人设表和世界书都为空。请先填写人设，或切到“关键词生成”。
                        {:else}
                            当前世界书为空。请先添加条目，或切到“关键词生成”。
                        {/if}
                    </div>
                {/if}

                <div class="flex items-center justify-between gap-4">
                    <div>
                        <Label for="world-info-count">生成条数</Label>
                        <p class="text-xs text-muted-foreground mt-1">一次 1–8 条，只调用一次模型。</p>
                    </div>
                    <Input
                        id="world-info-count"
                        type="number"
                        min="1"
                        max="8"
                        step="1"
                        bind:value={genCount}
                        class="w-20 text-center"
                    />
                </div>

                {#if generatedDrafts.length > 0}
                    <div class="space-y-3 border-t pt-4">
                        <div class="flex items-center justify-between">
                            <Label>生成预览</Label>
                            <span class="text-xs text-muted-foreground">可编辑、可取消勾选</span>
                        </div>
                        {#if generatedBrokenUnicodeCount > 0}
                            <div
                                role="alert"
                                class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                            >
                                检测到 {generatedBrokenUnicodeCount} 处损坏字符（�）。原字已经无法恢复；红框中的内容需要手动修改、取消勾选，或重新生成后才能加入世界书。
                            </div>
                        {/if}
                        {#each generatedDrafts as draft, index}
                            <div
                                class={cn(
                                    "rounded-xl border bg-card p-4 space-y-3",
                                    getDraftBrokenUnicodeCount(draft) > 0 && "border-destructive/60",
                                )}
                            >
                                <div class="flex items-start gap-3">
                                    <Checkbox
                                        aria-label={`选择第 ${index + 1} 条`}
                                        bind:checked={draft.selected}
                                        class="mt-2"
                                    />
                                    <div class="grid flex-1 gap-3 sm:grid-cols-2">
                                        <div class="space-y-1.5">
                                            <Label for={`generated-entry-name-${index}`}>条目名称</Label>
                                            <Input
                                                id={`generated-entry-name-${index}`}
                                                bind:value={draft.comment}
                                                aria-invalid={countBrokenUnicode(draft.comment) > 0}
                                            />
                                        </div>
                                        <div class="space-y-1.5">
                                            <Label for={`generated-entry-keys-${index}`}>触发关键词</Label>
                                            <Input
                                                id={`generated-entry-keys-${index}`}
                                                bind:value={draft.keysText}
                                                placeholder="用逗号或顿号分隔"
                                                aria-invalid={countBrokenUnicode(draft.keysText) > 0}
                                            />
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`移除第 ${index + 1} 条`}
                                        onclick={() => generatedDrafts = generatedDrafts.filter((_, i) => i !== index)}
                                    >
                                        <X class="h-4 w-4" />
                                    </Button>
                                </div>
                                <div class="space-y-1.5 pl-8">
                                    <Label for={`generated-entry-content-${index}`}>条目内容</Label>
                                    <Textarea
                                        id={`generated-entry-content-${index}`}
                                        bind:value={draft.content}
                                        rows={5}
                                        aria-invalid={countBrokenUnicode(draft.content) > 0}
                                    />
                                    {#if getDraftBrokenUnicodeCount(draft) > 0}
                                        <p class="text-xs text-destructive">
                                            本条有 {getDraftBrokenUnicodeCount(draft)} 处损坏字符；删除或改写所有 � 后可正常加入。
                                        </p>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>

            <Dialog.Footer>
                <Button variant="outline" onclick={() => isGenDialogOpen = false}>取消</Button>
                <Button
                    variant={generatedDrafts.length > 0 ? "outline" : "default"}
                    onclick={handleGenerateWorldInfo}
                    disabled={isGenerating || !canGenerate}
                >
                    {#if isGenerating}
                        <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                        生成中，别关...
                    {:else}
                        <Sparkles class="mr-2 h-4 w-4" />
                        {#if !canGenerate && genMode === "keywords"}
                            先填写关键词
                        {:else if !canGenerate}
                            {mode === "character" ? "需要人设或条目" : "需要已有条目"}
                        {:else}
                            {generatedDrafts.length > 0 ? "重新生成" : "开始生成"}
                        {/if}
                    {/if}
                </Button>
                {#if generatedDrafts.length > 0}
                    <Button
                        onclick={addGeneratedEntries}
                        disabled={!generatedDrafts.some((draft) => draft.selected) || selectedBrokenUnicodeCount > 0}
                    >
                        <Plus class="mr-2 h-4 w-4" />
                        加入世界书（{generatedDrafts.filter((draft) => draft.selected).length}）
                    </Button>
                {/if}
            </Dialog.Footer>
        </Dialog.Content>
    </Dialog.Root>
