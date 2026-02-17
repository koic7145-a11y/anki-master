// ============================================
// 暗記マスター - MemoryApp Class (IndexedDB Version)
// ============================================

class MemoryApp {
  constructor() {
    // SM-2 default parameters
    this.defaultEaseFactor = 2.5;
    this.minEaseFactor = 1.3;
    this.cards = [];
    this.decks = [];
    this.currentReviewCards = [];
    this.currentCardIndex = 0;
    this.correctCount = 0;
    this.isPracticeMode = false;
    this.activeCategory = 'all';
    this.searchQuery = '';

    // Image data holders for form
    this.questionImageData = null;
    this.answerImageData = null;

    // Focus tracking for paste
    this.lastFocusedUploadZone = null;

    // Initialize async
    this.init();
  }

  async init() {
    await this.loadData();
    await this.loadDecks();
    this.initEvents();
    this.populateDeckSelect();
    this.restoreLastCategory();
    this.render();

    // --- Supabase Sync setup ---
    if (typeof syncModule !== 'undefined') {
      syncModule.onSyncStatusChange = (status) => this.updateSyncUI(status);
      syncModule.onDataChange = async () => {
        await this.loadData();
        await this.loadDecks();
        this.populateDeckSelect();
        this.render();
      };
      // Restore session
      const session = await syncModule.getSession();
      if (session) {
        this.updateAuthUI(true, syncModule.user.email);
        syncModule.fullSync().then(() => syncModule.subscribeRealtime());
      }
    }
  }

  // --- Data Management ---

  async loadData() {
    try {
      this.cards = await db.cards.toArray();

      // Migration: Check LocalStorage if DB is empty
      if (this.cards.length === 0) {
        const raw = localStorage.getItem('memoryAppCards');
        if (raw) {
          try {
            const localCards = JSON.parse(raw);
            if (Array.isArray(localCards) && localCards.length > 0) {
              console.log('Migrating data from LocalStorage to IndexedDB...');
              await db.cards.bulkAdd(localCards);
              this.cards = localCards;
              this.showToast('データをデータベースへ移行しました');
            }
          } catch (e) {
            console.error('Migration failed:', e);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load data:', e);
      this.showToast('データの読み込みに失敗しました');
      this.cards = [];
    }
  }

  // --- Deck Management ---

  async loadDecks() {
    try {
      this.decks = await db.decks.toArray();
      const existingDeckNames = new Set(this.decks.map(d => d.name));

      const standardCategories = [
        '基礎理論', 'コンピュータシステム', 'データベース', 'ネットワーク', 'セキュリティ', 'システム開発',
        'プロジェクトマネジメント', 'サービスマネジメント',
        'システム戦略', '経営戦略', '企業と法務'
      ];

      const cardCategories = [...new Set(this.cards.map(c => c.category).filter(Boolean))];
      const allCategories = [...new Set([...standardCategories, ...cardCategories])];

      for (const cat of allCategories) {
        if (!existingDeckNames.has(cat)) {
          const deck = { id: this.generateId(), name: cat, createdAt: new Date().toISOString() };
          await db.decks.add(deck);
          this.decks.push(deck);
        }
      }
    } catch (e) {
      console.error('Failed to load decks:', e);
      this.decks = [];
    }
  }

  populateDeckSelect() {
    const select = document.getElementById('categorySelect');
    this.populateSelectElement(select, select.value);
  }

  populateSelectElement(select, currentValue) {
    select.innerHTML = '<option value="">デッキを選択してください</option>';

    const groups = {
      'テクノロジ系': [],
      'マネジメント系': [],
      'ストラテジ系': [],
      'その他': []
    };

    this.decks.forEach(deck => {
      const group = this.getDeckGroup(deck.name);
      groups[group].push(deck);
    });

    ['テクノロジ系', 'マネジメント系', 'ストラテジ系', 'その他'].forEach(groupName => {
      const groupDecks = groups[groupName];
      if (groupDecks.length > 0) {
        groupDecks.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        const optgroup = document.createElement('optgroup');
        optgroup.label = groupName;
        groupDecks.forEach(deck => {
          const opt = document.createElement('option');
          opt.value = deck.name;
          opt.textContent = deck.name;
          optgroup.appendChild(opt);
        });
        select.appendChild(optgroup);
      }
    });

    if (currentValue && this.decks.some(d => d.name === currentValue)) {
      select.value = currentValue;
    }
  }

  getDeckGroup(name) {
    const tech = ['基礎理論', 'コンピュータシステム', 'データベース', 'ネットワーク', 'セキュリティ', 'システム開発'];
    const mgmt = ['プロジェクトマネジメント', 'サービスマネジメント'];
    const strat = ['システム戦略', '経営戦略', '企業と法務'];

    if (tech.includes(name)) return 'テクノロジ系';
    if (mgmt.includes(name)) return 'マネジメント系';
    if (strat.includes(name)) return 'ストラテジ系';
    return 'その他';
  }

  async createDeck(name) {
    name = name.trim();
    if (!name) {
      this.showToast('デッキ名を入力してください');
      return null;
    }

    if (this.decks.some(d => d.name === name)) {
      this.showToast('同じ名前のデッキが既に存在します');
      return null;
    }

    const now = new Date().toISOString();
    const deck = {
      id: this.generateId(),
      name: name,
      createdAt: now,
      updatedAt: now,
      synced: 0,
      deleted: 0
    };

    try {
      await db.decks.add(deck);
      this.decks.push(deck);
      if (typeof syncModule !== 'undefined') syncModule.markDeckDirty(deck.id);
      this.populateDeckSelect();
      document.getElementById('categorySelect').value = name;
      this.showToast(`デッキ「${name}」を作成しました`);
      return deck;
    } catch (e) {
      console.error('Failed to create deck:', e);
      this.showToast('エラー: デッキの作成に失敗しました');
      return null;
    }
  }

  async deleteDeck(id) {
    const deck = this.decks.find(d => d.id === id);
    if (!deck) return;

    const cardCount = this.cards.filter(c => c.category === deck.name).length;
    if (!confirm(`デッキ「${deck.name}」を削除しますか？\n（${cardCount}枚のカードも削除されます）`)) return;

    try {
      const cardsToDelete = this.cards.filter(c => c.category === deck.name);
      for (const card of cardsToDelete) {
        await db.cards.delete(card.id);
      }
      this.cards = this.cards.filter(c => c.category !== deck.name);

      await db.decks.delete(id);
      this.decks = this.decks.filter(d => d.id !== id);

      this.populateDeckSelect();
      this.render();
      this.showToast(`デッキ「${deck.name}」を削除しました`);
    } catch (e) {
      console.error('Failed to delete deck:', e);
      this.showToast('エラー: デッキの削除に失敗しました');
    }
  }

  showNewDeckInput() {
    document.getElementById('newDeckInput').classList.remove('hidden');
    document.getElementById('presetDeckSelect').value = '';
    document.getElementById('newDeckName').value = '';
    document.getElementById('presetDeckSelect').focus();
  }

  hideNewDeckInput() {
    document.getElementById('newDeckInput').classList.add('hidden');
    document.getElementById('presetDeckSelect').value = '';
    document.getElementById('newDeckName').value = '';
  }

  getNewDeckName() {
    const preset = document.getElementById('presetDeckSelect').value;
    if (preset) return preset;
    return document.getElementById('newDeckName').value;
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  getStreak() {
    const lastDate = localStorage.getItem('lastStudyDate');
    const streak = parseInt(localStorage.getItem('studyStreak') || '0');
    return { lastDate, streak };
  }

  updateStreak() {
    const today = this.getDateString(new Date());
    const { lastDate, streak } = this.getStreak();

    if (lastDate === today) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = this.getDateString(yesterday);

    if (lastDate === yesterdayStr) {
      localStorage.setItem('studyStreak', (streak + 1).toString());
    } else {
      localStorage.setItem('studyStreak', '1');
    }
    localStorage.setItem('lastStudyDate', today);
  }

  getDateString(date) {
    const y = date.getFullYear();
    const m = ('00' + (date.getMonth() + 1)).slice(-2);
    const d = ('00' + date.getDate()).slice(-2);
    return `${y}-${m}-${d}`;
  }

  getLocalISOString(date) {
    const y = date.getFullYear();
    const m = ('00' + (date.getMonth() + 1)).slice(-2);
    const d = ('00' + date.getDate()).slice(-2);
    const h = ('00' + date.getHours()).slice(-2);
    const min = ('00' + date.getMinutes()).slice(-2);
    const s = ('00' + date.getSeconds()).slice(-2);
    return `${y}-${m}-${d}T${h}:${min}:${s}`;
  }

  getTodayString() {
    return this.getDateString(new Date());
  }

  // --- Event Initialization ---

  initEvents() {
    document.getElementById('addCardBtn').addEventListener('click', () => this.addCard());
    document.getElementById('clearFormBtn').addEventListener('click', () => this.clearForm());

    this.initUploadZone('questionUploadZone', 'questionFileInput', 'question');
    this.initUploadZone('answerUploadZone', 'answerFileInput', 'answer');

    // Deck management buttons
    document.getElementById('newDeckBtn').addEventListener('click', () => this.showNewDeckInput());
    document.getElementById('createDeckBtn').addEventListener('click', async () => {
      const name = this.getNewDeckName();
      const deck = await this.createDeck(name);
      if (deck) this.hideNewDeckInput();
    });
    document.getElementById('cancelNewDeckBtn').addEventListener('click', () => this.hideNewDeckInput());

    document.getElementById('presetDeckSelect').addEventListener('change', () => {
      document.getElementById('newDeckName').value = '';
    });
    document.getElementById('newDeckName').addEventListener('input', () => {
      document.getElementById('presetDeckSelect').value = '';
    });
    document.getElementById('newDeckName').addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = this.getNewDeckName();
        const deck = await this.createDeck(name);
        if (deck) this.hideNewDeckInput();
      } else if (e.key === 'Escape') {
        this.hideNewDeckInput();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        this.addCard();
      }
    });

    document.addEventListener('paste', (e) => this.handleGlobalPaste(e));

    document.getElementById('studyModalClose').addEventListener('click', () => this.closeStudyModal());
    document.getElementById('flashcard').addEventListener('click', () => this.flipCard());
    document.getElementById('btnAgain').addEventListener('click', () => this.answerCard(0));
    document.getElementById('btnHard').addEventListener('click', () => this.answerCard(1));
    document.getElementById('btnGood').addEventListener('click', () => this.answerCard(2));
    document.getElementById('btnEasy').addEventListener('click', () => this.answerCard(3));

    document.getElementById('btnRetry').addEventListener('click', () => this.retryCard());
    document.getElementById('btnFinish').addEventListener('click', () => this.closeStudyModal());

    document.getElementById('editModalClose').addEventListener('click', () => this.closeEditModal());
    document.getElementById('cancelEditBtn').addEventListener('click', () => this.closeEditModal());
    document.getElementById('saveEditBtn').addEventListener('click', () => this.saveEdit());

    document.getElementById('completeCloseBtn').addEventListener('click', () => this.closeCompleteModal());

    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.renderCardList();
    });

    ['studyModal', 'editModal', 'completeModal'].forEach(id => {
      document.getElementById(id).addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
          if (id === 'studyModal') this.closeStudyModal();
          else if (id === 'editModal') this.closeEditModal();
          else this.closeCompleteModal();
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeStudyModal();
        this.closeEditModal();
        this.closeCompleteModal();
      }
    });

    // Settings
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        document.getElementById('settingsModal').classList.add('active');
      });
    }
    document.getElementById('settingsCloseBtn').addEventListener('click', () => {
      document.getElementById('settingsModal').classList.remove('active');
    });

    document.getElementById('exportDataBtn').addEventListener('click', () => this.exportData());

    const importBtn = document.getElementById('importDataBtn');
    const fileInput = document.getElementById('importFileInput');
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.importData(e.target.files[0]);
        e.target.value = '';
      }
    });

    document.getElementById('settingsModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        document.getElementById('settingsModal').classList.remove('active');
      }
    });

    // --- Auth Events ---
    const authSubmitBtn = document.getElementById('authSubmitBtn');
    if (authSubmitBtn) {
      document.getElementById('authTabLogin').classList.add('btn-primary');

      authSubmitBtn.addEventListener('click', async () => {
        const email = document.getElementById('authEmail').value.trim();
        const password = document.getElementById('authPassword').value;
        const errEl = document.getElementById('authError');
        errEl.style.display = 'none';

        if (!email || !password) {
          errEl.textContent = 'メールアドレスとパスワードを入力してください';
          errEl.style.display = 'block';
          return;
        }

        const mode = authSubmitBtn.dataset.mode;
        authSubmitBtn.disabled = true;
        authSubmitBtn.textContent = '処理中...';

        try {
          let result;
          if (mode === 'signup') {
            const confirm = document.getElementById('authPasswordConfirm').value;
            if (password !== confirm) {
              errEl.textContent = 'パスワードが一致しません';
              errEl.style.display = 'block';
              return;
            }
            result = await syncModule.signUp(email, password);
          } else {
            result = await syncModule.signIn(email, password);
          }

          if (result.error) {
            errEl.textContent = result.error.message;
            errEl.style.display = 'block';
          } else {
            this.updateAuthUI(true, email);
            this.showToast(mode === 'signup' ? 'アカウントを作成しました' : 'ログインしました');
          }
        } catch (e) {
          errEl.textContent = 'エラーが発生しました';
          errEl.style.display = 'block';
        } finally {
          authSubmitBtn.disabled = false;
          authSubmitBtn.textContent = mode === 'signup' ? '新規登録' : 'ログイン';
        }
      });
    }

    // --- Header Actions ---
    const headerSyncBtn = document.getElementById('headerSyncBtn');
    if (headerSyncBtn) {
      headerSyncBtn.addEventListener('click', async () => {
        if (!syncModule || !syncModule.isLoggedIn()) {
          this.showToast('ログインしていません。設定からログインしてください。');
          return;
        }

        const icon = headerSyncBtn.querySelector('svg');
        icon.style.transition = 'transform 1s';
        icon.style.transform = 'rotate(360deg)';

        await syncModule.fullSync();
        this.showToast('同期が完了しました');
        const lastSyncEl = document.getElementById('lastSyncTime');
        if (lastSyncEl) {
          lastSyncEl.textContent = `最終同期: ${new Date().toLocaleTimeString('ja-JP')}`;
        }

        setTimeout(() => {
          icon.style.transform = 'none';
        }, 1000);
      });
    }

    const headerLogoutBtn = document.getElementById('headerLogoutBtn');
    if (headerLogoutBtn) {
      headerLogoutBtn.addEventListener('click', async () => {
        if (confirm('ログアウトしますか？')) {
          await syncModule.signOut();
          this.updateAuthUI(false);
          this.showToast('ログアウトしました');
        }
      });
    }

    this.checkStreakOnLoad();
  }

  // --- Sync UI Helpers ---

  updateAuthUI(loggedIn, email) {
    const formSection = document.getElementById('authFormSection');
    const loggedSection = document.getElementById('loggedInSection');
    if (!formSection || !loggedSection) return;

    if (loggedIn) {
      formSection.classList.add('hidden');
      loggedSection.classList.remove('hidden');
      document.getElementById('loggedInEmail').textContent = email || '';
    } else {
      formSection.classList.remove('hidden');
      loggedSection.classList.add('hidden');
      document.getElementById('authEmail').value = '';
      document.getElementById('authPassword').value = '';
    }

    const headerLogoutBtn = document.getElementById('headerLogoutBtn');
    if (headerLogoutBtn) {
      if (loggedIn) headerLogoutBtn.classList.remove('hidden');
      else headerLogoutBtn.classList.add('hidden');
    }
  }

  updateSyncUI(status) {
    const dot = document.querySelector('.sync-dot');
    const text = document.getElementById('syncText');
    if (!dot || !text) return;

    dot.className = 'sync-dot';
    switch (status) {
      case 'synced':
        dot.classList.add('synced');
        text.textContent = '同期済';
        break;
      case 'syncing':
        dot.classList.add('syncing');
        text.textContent = '同期中';
        break;
      case 'error':
        dot.classList.add('error');
        text.textContent = 'エラー';
        break;
      default:
        dot.classList.add('offline');
        text.textContent = '未接続';
    }
  }

  checkStreakOnLoad() {
    const today = this.getTodayString();
    const { lastDate } = this.getStreak();
    if (!lastDate) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = this.getDateString(yesterday);

    if (lastDate !== today && lastDate !== yesterdayStr) {
      localStorage.setItem('studyStreak', '0');
    }
  }

  // --- Image Upload ---

  initUploadZone(zoneId, inputId, type) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);

    zone.addEventListener('focus', () => { this.lastFocusedUploadZone = type; });
    zone.addEventListener('click', () => {
      this.lastFocusedUploadZone = type;
      input.click();
    });

    input.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.processImage(e.target.files[0], type);
      }
    });

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      this.lastFocusedUploadZone = type;
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        this.processImage(e.dataTransfer.files[0], type);
      }
    });
  }

  handleGlobalPaste(e) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        let target = this.lastFocusedUploadZone;
        if (!target) {
          if (!this.questionImageData) target = 'question';
          else if (!this.answerImageData) target = 'answer';
          else target = 'question';
        }
        this.processImage(file, target);
        break;
      }
    }
  }

  processImage(file, type) {
    if (!file.type.startsWith('image/')) {
      this.showToast('画像ファイルを選択してください');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;

        if (w > 800 || h > 800) {
          if (w > h) {
            h = Math.round(h * 800 / w);
            w = 800;
          } else {
            w = Math.round(w * 800 / h);
            h = 800;
          }
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

        if (type === 'question') {
          this.questionImageData = dataUrl;
          this.renderUploadPreview('questionUploadZone', dataUrl, 'question');
        } else {
          this.answerImageData = dataUrl;
          this.renderUploadPreview('answerUploadZone', dataUrl, 'answer');
        }

        this.autoFocusCategory();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  autoFocusCategory() {
    if (this.questionImageData && this.answerImageData) {
      document.getElementById('deckSelectionSection').classList.remove('hidden');
      document.getElementById('categorySelect').focus();
    }
  }

  renderUploadPreview(zoneId, dataUrl, type) {
    const zone = document.getElementById(zoneId);
    zone.classList.add('has-image');
    zone.innerHTML = `
      <div class="image-preview-container">
        <img src="${dataUrl}" class="image-preview" alt="プレビュー">
        <button class="image-preview-remove" onclick="event.stopPropagation(); app.removeImage('${type}')" title="削除">×</button>
      </div>
    `;
  }

  removeImage(type) {
    if (type === 'question') {
      this.questionImageData = null;
      this.resetUploadZone('questionUploadZone', 'questionFileInput');
    } else {
      this.answerImageData = null;
      this.resetUploadZone('answerUploadZone', 'answerFileInput');
    }
  }

  resetUploadZone(zoneId, inputId) {
    const zone = document.getElementById(zoneId);
    zone.classList.remove('has-image');
    zone.innerHTML = `
      <svg viewBox="0 0 24 24"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="upload-zone-text">クリック / ドロップ / Ctrl+V</div>
      <div class="upload-zone-hint">画像をアップロード</div>
      <input type="file" id="${inputId}" accept="image/*">
    `;
    const input = document.getElementById(inputId);
    const type = inputId.startsWith('question') ? 'question' : 'answer';
    input.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.processImage(e.target.files[0], type);
      }
    });
  }

  // --- Card CRUD ---

  async addCard() {
    if (!this.questionImageData || !this.answerImageData) {
      this.showToast('問題画像と解答画像を設定してください');
      return;
    }

    const category = document.getElementById('categorySelect').value || '未分類';

    const now = new Date().toISOString();
    const card = {
      id: this.generateId(),
      question: '',
      answer: '',
      questionImage: this.questionImageData,
      answerImage: this.answerImageData,
      category: category,
      level: 0,
      easeFactor: this.defaultEaseFactor,
      interval: 0,
      repetitions: 0,
      nextReview: this.getTodayString(),
      reviewHistory: [],
      createdAt: now,
      updatedAt: now,
      synced: 0,
      deleted: 0
    };

    try {
      await db.cards.add(card);
      this.cards.push(card);
      localStorage.setItem('lastCategory', category);
      this.showToast('カードを追加しました');

      if (typeof syncModule !== 'undefined') syncModule.markCardDirty(card.id);

      const continuous = document.getElementById('continuousMode').checked;
      if (continuous) {
        this.clearFormImages();
        document.getElementById('questionUploadZone').focus();
      } else {
        this.clearForm();
      }

      this.render();
    } catch (e) {
      console.error('Failed to add card:', e);
      this.showToast('エラー: カードの保存に失敗しました');
    }
  }

  clearForm() {
    this.clearFormImages();
    document.getElementById('categorySelect').value = '';
  }

  clearFormImages() {
    this.questionImageData = null;
    this.answerImageData = null;
    this.resetUploadZone('questionUploadZone', 'questionFileInput');
    this.resetUploadZone('answerUploadZone', 'answerFileInput');
    document.getElementById('deckSelectionSection').classList.add('hidden');
  }

  async deleteCard(id) {
    if (!confirm('このカードを削除しますか？')) return;

    try {
      await db.cards.update(id, { deleted: 1, synced: 0, updatedAt: new Date().toISOString() });
      if (typeof syncModule !== 'undefined' && syncModule.isLoggedIn()) {
        await syncModule.pushChanges();
      }
      await db.cards.delete(id);
      this.cards = this.cards.filter(c => c.id !== id);
      this.render();
      this.showToast('カードを削除しました');
    } catch (e) {
      console.error('Failed to delete card:', e);
      this.showToast('エラー: 削除に失敗しました');
    }
  }

  // --- Edit ---

  openEditModal(id) {
    const card = this.cards.find(c => c.id === id);
    if (!card) return;

    document.getElementById('editCardId').value = card.id;
    document.getElementById('editQuestion').value = card.question || '';
    document.getElementById('editAnswer').value = card.answer || '';

    const editSelect = document.getElementById('editCategory');
    this.populateSelectElement(editSelect, card.category);

    document.getElementById('editModal').classList.add('active');
  }

  closeEditModal() {
    document.getElementById('editModal').classList.remove('active');
  }

  async saveEdit() {
    const id = document.getElementById('editCardId').value;
    const card = this.cards.find(c => c.id === id);
    if (!card) return;

    card.question = document.getElementById('editQuestion').value.trim();
    card.answer = document.getElementById('editAnswer').value.trim();
    card.category = document.getElementById('editCategory').value;

    try {
      card.updatedAt = new Date().toISOString();
      card.synced = 0;
      await db.cards.put(card);
      if (typeof syncModule !== 'undefined') syncModule.markCardDirty(card.id);
      this.closeEditModal();
      this.render();
      this.showToast('カードを更新しました');
    } catch (e) {
      console.error('Failed to update card:', e);
      this.showToast('エラー: 更新に失敗しました');
    }
  }

  // --- Review / Study ---

  getReviewCards() {
    const now = this.getLocalISOString(new Date());
    return this.cards.filter(c => c.nextReview <= now);
  }

  startReview() {
    const reviewCards = this.getReviewCards();
    if (reviewCards.length === 0) {
      this.showToast('復習するカードがありません');
      return;
    }

    this.currentReviewCards = this.shuffleArray([...reviewCards]);
    this.currentCardIndex = 0;
    this.correctCount = 0;
    this.isPracticeMode = false;

    document.getElementById('studyModalTitle').textContent = '復習中';
    this.showStudyModal();
  }

  startSingleCardReview(id) {
    const card = this.cards.find(c => c.id === id);
    if (!card) return;

    this.currentReviewCards = [card];
    this.currentCardIndex = 0;
    this.correctCount = 0;
    this.practiceTotal = 0;
    this.isPracticeMode = true;

    document.getElementById('studyModalTitle').textContent = '練習モード';
    this.showStudyModal();
  }

  showStudyModal() {
    this.renderStudyCard();
    document.getElementById('studyModal').classList.add('active');
  }

  closeStudyModal() {
    document.getElementById('studyModal').classList.remove('active');
    document.getElementById('flashcard').classList.remove('flipped');
    document.getElementById('answerButtons').classList.add('hidden');
    document.getElementById('practiceButtons').classList.add('hidden');
    this.render();
  }

  renderStudyCard() {
    const card = this.currentReviewCards[this.currentCardIndex];
    const total = this.currentReviewCards.length;
    const current = this.currentCardIndex + 1;

    if (this.isPracticeMode) {
      const pct = this.practiceTotal > 0 ? Math.round((this.correctCount / this.practiceTotal) * 100) : 0;
      document.getElementById('progressLabel').textContent = `⭕ ${this.correctCount}  ❌ ${this.practiceTotal - this.correctCount}`;
      document.getElementById('progressPercent').textContent = this.practiceTotal > 0 ? `${pct}%` : '';
      document.getElementById('progressBar').style.width = `${pct}%`;
    } else {
      const pct = Math.round((current / total) * 100);
      document.getElementById('progressLabel').textContent = `${current} / ${total}`;
      document.getElementById('progressPercent').textContent = `${pct}%`;
      document.getElementById('progressBar').style.width = `${pct}%`;
    }

    const frontContent = document.getElementById('flashcardFront');
    if (card.questionImage) {
      frontContent.innerHTML = `<img src="${card.questionImage}" class="flashcard-image" alt="問題">`;
    } else {
      frontContent.innerHTML = this.escapeHtml(card.question || '(テキストなし)');
    }

    const backContent = document.getElementById('flashcardBack');
    if (card.answerImage) {
      backContent.innerHTML = `<img src="${card.answerImage}" class="flashcard-image" alt="解答">`;
    } else {
      backContent.innerHTML = this.escapeHtml(card.answer || '(テキストなし)');
    }

    document.getElementById('flashcard').classList.remove('flipped');
    document.getElementById('answerButtons').classList.add('hidden');
    document.getElementById('practiceButtons').classList.add('hidden');
  }

  flipCard() {
    const flashcard = document.getElementById('flashcard');
    if (flashcard.classList.contains('flipped')) return;

    flashcard.classList.add('flipped');

    if (this.isPracticeMode) {
      document.getElementById('practiceButtons').classList.remove('hidden');
    } else {
      const card = this.currentReviewCards[this.currentCardIndex];
      this.showIntervalLabels(card);
      document.getElementById('answerButtons').classList.remove('hidden');
    }
  }

  // SM-2 Algorithm
  calculateSM2(card, quality) {
    let easeFactor = card.easeFactor || this.defaultEaseFactor;
    let interval = card.interval || 0;
    let repetitions = card.repetitions || 0;
    let isMinutes = false;

    if (quality === 0) {
      repetitions = 0;
      interval = 1;
      isMinutes = true;
    } else if (quality === 1) {
      if (repetitions === 0) {
        interval = 6;
        isMinutes = true;
      } else {
        interval = Math.max(1, Math.round(interval * 1.2));
      }
      easeFactor = Math.max(this.minEaseFactor, easeFactor - 0.15);
    } else if (quality === 2) {
      if (repetitions === 0) {
        interval = 10;
        isMinutes = true;
      } else if (repetitions === 1) {
        interval = 1;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitions++;
    } else if (quality === 3) {
      if (repetitions === 0) {
        interval = 4;
      } else if (repetitions === 1) {
        interval = 10;
      } else {
        interval = Math.round(interval * easeFactor * 1.3);
      }
      easeFactor = Math.max(this.minEaseFactor, easeFactor + 0.15);
      repetitions++;
    }

    return { easeFactor, interval, repetitions, isMinutes };
  }

  showIntervalLabels(card) {
    const grades = [0, 1, 2, 3];
    const labels = ['intervalAgain', 'intervalHard', 'intervalGood', 'intervalEasy'];

    grades.forEach((q, i) => {
      const result = this.calculateSM2(card, q);
      document.getElementById(labels[i]).textContent = this.formatIntervalLabel(result.interval, result.isMinutes);
    });
  }

  formatIntervalLabel(value, isMinutes) {
    if (isMinutes) {
      if (value < 60) return `${value}分`;
      return `${Math.round(value / 60)}時間`;
    }
    if (value <= 0) return '< 1日';
    if (value === 1) return '1日';
    if (value < 30) return `${value}日`;
    if (value < 365) {
      const months = Math.round(value / 30);
      return `${months}ヶ月`;
    }
    const years = (value / 365).toFixed(1);
    return `${years}年`;
  }

  retryCard() {
    this.answerCard(0);
  }

  async answerCard(quality) {
    const card = this.currentReviewCards[this.currentCardIndex];

    if (this.isPracticeMode) {
      this.practiceTotal++;
      if (quality >= 2) this.correctCount++;
      this.renderStudyCard();
      return;
    }

    const result = this.calculateSM2(card, quality);
    card.easeFactor = result.easeFactor;
    card.interval = result.interval;
    card.repetitions = result.repetitions;

    if (quality >= 2) {
      card.level = Math.min((card.level || 0) + 1, 5);
      this.correctCount++;
    } else if (quality === 0) {
      card.level = 0;
    }

    const next = new Date();
    if (result.isMinutes) {
      next.setMinutes(next.getMinutes() + result.interval);
      card.nextReview = this.getLocalISOString(next);
    } else {
      next.setDate(next.getDate() + result.interval);
      card.nextReview = this.getDateString(next);
    }

    card.reviewHistory.push({
      date: this.getTodayString(),
      quality: quality,
      correct: quality >= 2
    });

    try {
      card.updatedAt = new Date().toISOString();
      card.synced = 0;
      await db.cards.put(card);
      if (typeof syncModule !== 'undefined') syncModule.markCardDirty(card.id);
      this.updateStreak();

      this.currentCardIndex++;
      if (this.currentCardIndex < this.currentReviewCards.length) {
        this.renderStudyCard();
      } else {
        this.closeStudyModal();
        this.showCompleteModal();
      }
    } catch (e) {
      console.error('Failed to update card progress:', e);
      this.showToast('エラー: 進捗の保存に失敗しました');
    }
  }

  // --- Complete Modal ---

  showCompleteModal() {
    const total = this.currentReviewCards.length;
    const correct = this.correctCount;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    let icon, message;
    const starSvg = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    const trophySvg = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 1012 0V2z"/></svg>';
    const bookSvg = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>';
    const seedSvg = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V8"/><path d="M5.2 11c1-.6 2.3-.8 3.5-.5 1.2.3 2.2 1 2.8 2"/><path d="M18.8 11c-1-.6-2.3-.8-3.5-.5-1.2.3-2.2 1-2.8 2"/><path d="M12 2a5 5 0 015 5c0 2-1 3.5-2.5 4.5"/><path d="M12 2a5 5 0 00-5 5c0 2 1 3.5 2.5 4.5"/></svg>';

    if (pct === 100) {
      icon = starSvg;
      message = '完璧です！素晴らしい記憶力ですね！';
    } else if (pct >= 80) {
      icon = trophySvg;
      message = 'とても良い結果です！この調子で頑張りましょう！';
    } else if (pct >= 60) {
      icon = bookSvg;
      message = 'まずまずの結果です。復習を続けましょう！';
    } else {
      icon = seedSvg;
      message = '繰り返し復習することで定着します。頑張りましょう！';
    }

    document.getElementById('completeIcon').innerHTML = icon;
    document.getElementById('completeTitle').textContent = '学習完了！';
    document.getElementById('completeStats').textContent = `${total}枚中${correct}枚正解（${pct}%）`;
    document.getElementById('completeMessage').textContent = message;
    document.getElementById('completeModal').classList.add('active');
  }

  closeCompleteModal() {
    document.getElementById('completeModal').classList.remove('active');
  }

  // --- Rendering ---

  render() {
    this.renderStats();
    this.renderAccuracy();
    this.renderReviewSection();
    this.renderCategoryTabs();
    this.renderCardList();
  }

  renderStats() {
    const now = this.getLocalISOString(new Date());
    const total = this.cards.length;
    const dueCount = this.cards.filter(c => c.nextReview <= now).length;
    const mastered = this.cards.filter(c => (c.repetitions || 0) >= 3).length;
    const { streak } = this.getStreak();

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statToday').textContent = dueCount;
    document.getElementById('statMastered').textContent = mastered;
    document.getElementById('statStreak').textContent = streak;
  }

  renderAccuracy() {
    const container = document.getElementById('accuracyList');
    const catMap = {};

    this.cards.forEach(card => {
      if (!catMap[card.category]) {
        catMap[card.category] = { total: 0, correct: 0 };
      }
      card.reviewHistory.forEach(h => {
        catMap[card.category].total++;
        if (h.correct) catMap[card.category].correct++;
      });
    });

    const entries = Object.entries(catMap)
      .filter(([, v]) => v.total > 0)
      .sort((a, b) => {
        const pctA = a[1].correct / a[1].total;
        const pctB = b[1].correct / b[1].total;
        return pctB - pctA;
      });

    if (entries.length === 0) {
      container.innerHTML = '<div class="empty-state">学習データがありません</div>';
      return;
    }

    container.innerHTML = entries.map(([cat, data]) => {
      const pct = Math.round((data.correct / data.total) * 100);
      return `
        <div class="accuracy-item">
          <div class="accuracy-header">
            <span class="accuracy-category">${this.escapeHtml(cat)}</span>
            <span class="accuracy-stats">${data.correct}/${data.total}（${pct}%）</span>
          </div>
          <div class="accuracy-bar-bg">
            <div class="accuracy-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  renderReviewSection() {
    const reviewCards = this.getReviewCards();
    const container = document.getElementById('reviewSection');

    if (reviewCards.length === 0) {
      container.innerHTML = `
        <div class="no-review">
          <div class="no-review-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
          <div class="no-review-text">今日復習するカードはありません！</div>
        </div>
      `;
      return;
    }

    const previewCards = reviewCards.slice(0, 6);
    let html = '<div class="review-cards-preview">';
    previewCards.forEach(card => {
      html += `
        <div class="review-preview-card">
          ${card.questionImage ? `<img src="${card.questionImage}" alt="問題">` : `<div style="padding:8px;font-size:0.75rem;color:var(--text-secondary);">${this.escapeHtml((card.question || '').substring(0, 30))}</div>`}
          <div class="preview-category">${this.escapeHtml(card.category)}</div>
        </div>
      `;
    });
    html += '</div>';

    html += `
      <button class="btn btn-primary btn-block" onclick="app.startReview()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg> 復習を開始（${reviewCards.length}枚）
      </button>
    `;

    container.innerHTML = html;
  }

  renderCategoryTabs() {
    const container = document.getElementById('categoryTabs');
    const catCounts = {};

    this.cards.forEach(card => {
      catCounts[card.category] = (catCounts[card.category] || 0) + 1;
    });

    const allCount = this.cards.length;
    let html = `<button class="category-tab ${this.activeCategory === 'all' ? 'active' : ''}" onclick="app.setCategory('all')">すべて<span class="tab-count">${allCount}</span></button>`;

    Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => {
        html += `<button class="category-tab ${this.activeCategory === cat ? 'active' : ''}" onclick="app.setCategory('${this.escapeHtml(cat)}')">${this.escapeHtml(cat)}<span class="tab-count">${count}</span></button>`;
      });

    container.innerHTML = html;
  }

  setCategory(cat) {
    this.activeCategory = cat;
    this.renderCategoryTabs();
    this.renderCardList();
  }

  renderCardList() {
    const container = document.getElementById('cardList');
    let filtered = this.cards;

    if (this.activeCategory !== 'all') {
      filtered = filtered.filter(c => c.category === this.activeCategory);
    }

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        (c.question && c.question.toLowerCase().includes(q)) ||
        (c.answer && c.answer.toLowerCase().includes(q)) ||
        c.category.toLowerCase().includes(q)
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state">カードがありません</div>';
      return;
    }

    container.innerHTML = filtered.map(card => {
      const levelText = `Lv.${card.level + 1}`;
      const nextReviewText = this.formatNextReview(card.nextReview);

      return `
        <div class="card-item" onclick="app.startSingleCardReview('${card.id}')">
          ${card.questionImage
          ? `<img src="${card.questionImage}" class="card-item-thumbnail" alt="問題" style="max-height:100px">`
          : `<div class="card-item-thumbnail" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--text-tertiary);">No Image</div>`
        }
          <div class="card-item-info">
            <div class="card-item-category">${this.escapeHtml(card.category)}</div>
            <div class="card-item-question">${this.escapeHtml(card.question || '画像カード')}</div>
            <div class="card-item-meta">
              <span class="card-item-level">${levelText}</span>
              <span>次回: ${nextReviewText}</span>
            </div>
          </div>
          <div class="card-item-actions">
            <button class="card-action-btn" onclick="event.stopPropagation(); app.openEditModal('${card.id}')" title="編集">
              <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="card-action-btn delete-btn" onclick="event.stopPropagation(); app.deleteCard('${card.id}')" title="削除">
              <svg viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Category Persistence ---

  restoreLastCategory() {
    const last = localStorage.getItem('lastCategory');
    if (last) {
      const select = document.getElementById('categorySelect');
      const options = Array.from(select.options);
      if (options.some(o => o.value === last)) {
        select.value = last;
      }
    }
  }

  // --- Utility ---

  formatNextReview(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reviewDate = new Date(dateStr + 'T00:00:00');

    const diffTime = reviewDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return '今日';
    if (diffDays === 1) return '明日';
    return `${diffDays}日後`;
  }

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Data Management ---

  async exportData() {
    try {
      const data = {
        cards: await db.cards.toArray(),
        decks: await db.decks.toArray(),
        exportDate: new Date().toISOString()
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: `memory-app-backup-${this.getDateString(new Date())}.json`,
            types: [{
              description: 'JSON File',
              accept: { 'application/json': ['.json'] },
            }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          this.showToast('データを保存しました');
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn('File System Access API failed, falling back to download', err);
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `memory-app-backup-${this.getDateString(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showToast('データを書き出しました');
    } catch (e) {
      console.error('Export failed:', e);
      this.showToast('書き出しに失敗しました');
    }
  }

  async importData(file) {
    if (!file) return;

    if (!confirm('現在のデータに追加・上書きされます。よろしいですか？')) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = e.target.result;
        const data = JSON.parse(json);

        if (!data.cards || !data.decks) {
          throw new Error('無効なデータ形式です');
        }

        await db.transaction('rw', db.cards, db.decks, async () => {
          if (data.decks && Array.isArray(data.decks)) {
            for (const deck of data.decks) {
              await db.decks.put(deck);
            }
          }

          if (data.cards && Array.isArray(data.cards)) {
            for (const card of data.cards) {
              await db.cards.put(card);
            }
          }
        });

        this.showToast('データを読み込みました');

        await this.loadData();
        await this.loadDecks();
        this.render();

      } catch (err) {
        console.error('Import failed:', err);
        this.showToast('読み込みに失敗しました: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
}

// Start App
const app = new MemoryApp();

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered:', reg))
      .catch(err => console.log('Service Worker registration failed:', err));
  });
}
