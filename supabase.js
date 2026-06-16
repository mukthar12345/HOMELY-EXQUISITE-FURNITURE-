// 🏆 HOMELY EXQUISITE - COMPLETE BACKEND (FINAL)
console.log('🏆 HOMELY EXQUISITE - BACKEND READY');

const SUPABASE_URL = 'https://trswmahvppkvpwhtbiyw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyc3dtYWh2cHBrdnB3aHRiaXl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTIwNzAsImV4cCI6MjA5NTEyODA3MH0.fgBA1qFZwn9KEYc78Odwj83j9Pq61igbStRYYNRwywc';

// ================================================================
// CACHE MANAGER
// ================================================================
const CacheManager = {
    cachePrefix: 'homely_',
    cacheTTL: 5 * 60 * 1000,
    set: (key, data) => { try { localStorage.setItem(CacheManager.cachePrefix + key, JSON.stringify({data, timestamp: Date.now()})); } catch(e){} },
    get: (key) => { try { const cached = localStorage.getItem(CacheManager.cachePrefix + key); if(!cached) return null; const {data, timestamp} = JSON.parse(cached); if(Date.now() - timestamp > CacheManager.cacheTTL) { localStorage.removeItem(CacheManager.cachePrefix + key); return null; } return data; } catch(e){ return null; } },
    clear: (key) => { try { localStorage.removeItem(CacheManager.cachePrefix + key); } catch(e){} }
};

// ================================================================
// LOCAL CART (for non-logged-in users)
// ================================================================
const localCart = {
    get: () => JSON.parse(localStorage.getItem('homely_cart') || '[]'),
    set: (cart) => localStorage.setItem('homely_cart', JSON.stringify(cart)),
    add: (product) => { const cart = localCart.get(); const existing = cart.find(p => p.id === product.id); if(existing) existing.quantity++; else cart.push({...product, quantity: 1}); localCart.set(cart); return cart; },
    remove: (productId) => { let cart = localCart.get(); cart = cart.filter(p => p.id !== productId); localCart.set(cart); return cart; },
    clear: () => { localStorage.setItem('homely_cart', '[]'); }
};

// ================================================================
// SUPABASE INIT
// ================================================================
let initAttempts = 0;
function initSupabaseClient() {
    if(typeof window.supabase === 'undefined') {
        if(initAttempts < 10) { initAttempts++; setTimeout(initSupabaseClient, 150); return; }
        console.error('❌ Supabase not loaded');
        return;
    }
    try {
        window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('✅ Supabase Ready');
    } catch(e) { console.error('❌ Supabase error:', e.message); }
}
if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupabaseClient);
} else {
    initSupabaseClient();
}

// ================================================================
// AUTHENTICATION
// ================================================================
async function checkUser() { try { const {data: {user}} = await window.supabase.auth.getUser(); return user; } catch(e){ return null; } }
async function signUp(email, password, userData) { try { if(!validateEmail(email)) throw new Error('Invalid email'); if(!validatePassword(password)) throw new Error('Password min 6 chars'); const {data, error} = await window.supabase.auth.signUp({email, password, options: {data: {full_name: userData.full_name || '', phone: userData.phone || '', is_admin: false, created_at: new Date().toISOString()}}}); if(error) throw error; return data; } catch(e){ throw e; } }
async function logIn(email, password) { try { if(!validateEmail(email)) throw new Error('Invalid email'); const {data, error} = await window.supabase.auth.signInWithPassword({email, password}); if(error) throw error; CacheManager.clear('user_profile'); return data; } catch(e){ throw e; } }
async function logOut() { try { await window.supabase.auth.signOut(); CacheManager.clear('user_profile'); CacheManager.clear('products'); localCart.clear(); window.location.href = 'index.html'; } catch(e){} }
async function getUserProfile() { try { const cached = CacheManager.get('user_profile'); if(cached) return cached; const user = await checkUser(); if(!user) return null; const profile = {id: user.id, email: user.email, full_name: user.user_metadata?.full_name || '', phone: user.user_metadata?.phone || '', is_admin: user.user_metadata?.is_admin === true, created_at: user.user_metadata?.created_at || null}; CacheManager.set('user_profile', profile); return profile; } catch(e){ return null; } }
async function updateUserProfile(updates) { try { const {error} = await window.supabase.auth.updateUser({data: updates}); if(error) throw error; CacheManager.clear('user_profile'); return true; } catch(e){ throw e; } }
async function resetPassword(email) { try { if(!validateEmail(email)) throw new Error('Invalid email'); const {error} = await window.supabase.auth.resetPasswordForEmail(email, {redirectTo: window.location.origin + '/reset-password.html'}); if(error) throw error; return true; } catch(e){ throw e; } }

// ================================================================
// PRODUCTS (FIXED: removed 'created_by' column)
// ================================================================
async function addProduct(productData) { 
    try { 
        const user = await checkUser(); 
        if(!user) throw new Error('Not authenticated'); 
        const profile = await getUserProfile(); 
        if(!profile.is_admin) throw new Error('Admin required'); 
        if(!productData.name || productData.name.trim().length < 3) throw new Error('Product name required'); 
        if(!productData.price || parseFloat(productData.price) <= 0) throw new Error('Valid price required'); 
        const {data, error} = await window.supabase.from('products').insert([{
            name: productData.name.trim(), 
            description: productData.description || '', 
            category: productData.category || 'furniture', 
            price: parseFloat(productData.price), 
            image_url: productData.image_url || '', 
            badge: productData.badge || 'New', 
            stock: parseInt(productData.stock) || 0, 
            created_at: new Date().toISOString()
        }]).select(); 
        if(error) throw error; 
        CacheManager.clear('products'); 
        return data[0]; 
    } catch(e){ throw e; } 
}
async function getProducts(category = null, limit = 100) { try { const cacheKey = `products_${category || 'all'}_${limit}`; const cached = CacheManager.get(cacheKey); if(cached) return cached; let query = window.supabase.from('products').select('*').limit(limit).order('created_at', {ascending: false}); if(category && category !== 'all') query = query.eq('category', category); const {data, error} = await query; if(error) throw error; CacheManager.set(cacheKey, data); return data || []; } catch(e){ return []; } }
async function getProductById(productId) { try { const cacheKey = `product_${productId}`; const cached = CacheManager.get(cacheKey); if(cached) return cached; const {data, error} = await window.supabase.from('products').select('*').eq('id', productId).single(); if(error) throw error; CacheManager.set(cacheKey, data); return data; } catch(e){ return null; } }
async function updateProduct(productId, updates) { try { const {data, error} = await window.supabase.from('products').update(updates).eq('id', productId).select(); if(error) throw error; CacheManager.clear('products'); CacheManager.clear(`product_${productId}`); return data[0]; } catch(e){ throw e; } }
async function editProduct(productId, updates) { try { const user = await checkUser(); if(!user) throw new Error('Not authenticated'); const profile = await getUserProfile(); if(!profile.is_admin) throw new Error('Admin required'); return await updateProduct(productId, updates); } catch(e){ throw e; } }
async function deleteProduct(productId) { try { const {error} = await window.supabase.from('products').delete().eq('id', productId); if(error) throw error; CacheManager.clear('products'); CacheManager.clear(`product_${productId}`); return true; } catch(e){ throw e; } }

// ================================================================
// CART (Supabase)
// ================================================================
async function addToCart(productId, quantity = 1) { try { const user = await checkUser(); if(!user) throw new Error('Please login first'); const product = await getProductById(productId); if(!product) throw new Error('Product not found'); if(product.stock <= 0) throw new Error('Product out of stock'); const {data, error} = await window.supabase.from('cart').insert([{user_id: user.id, product_id: productId, quantity, added_at: new Date().toISOString()}]).select(); if(error) throw error; CacheManager.clear('cart'); return data[0]; } catch(e){ throw e; } }
async function getCart() { try { const user = await checkUser(); if(!user) return []; const cacheKey = `cart_${user.id}`; const cached = CacheManager.get(cacheKey); if(cached) return cached; const {data, error} = await window.supabase.from('cart').select('*, products(*)').eq('user_id', user.id); if(error) throw error; CacheManager.set(cacheKey, data); return data || []; } catch(e){ return []; } }
async function removeFromCart(cartId) { try { const {error} = await window.supabase.from('cart').delete().eq('id', cartId); if(error) throw error; const user = await checkUser(); if(user) CacheManager.clear(`cart_${user.id}`); return true; } catch(e){ throw e; } }
async function clearCart() { try { const user = await checkUser(); if(!user) return; const {error} = await window.supabase.from('cart').delete().eq('user_id', user.id); if(error) throw error; CacheManager.clear(`cart_${user.id}`); return true; } catch(e){ throw e; } }
async function getCartCount() { try { const user = await checkUser(); if(!user) return 0; const {data, error} = await window.supabase.from('cart').select('id').eq('user_id', user.id); if(error) throw error; return data ? data.length : 0; } catch(e){ return 0; } }

// ================================================================
// WISHLIST
// ================================================================
async function addToWishlist(productId) { try { const user = await checkUser(); if(!user) throw new Error('Please login to save items'); const {data, error} = await window.supabase.from('wishlist').insert([{user_id: user.id, product_id: productId, added_at: new Date().toISOString()}]).select(); if(error) throw error; CacheManager.clear('wishlist'); return data[0]; } catch(e){ throw e; } }
async function getWishlist() { try { const user = await checkUser(); if(!user) return []; const cacheKey = `wishlist_${user.id}`; const cached = CacheManager.get(cacheKey); if(cached) return cached; const {data, error} = await window.supabase.from('wishlist').select('*, products(*)').eq('user_id', user.id); if(error) throw error; CacheManager.set(cacheKey, data); return data || []; } catch(e){ return []; } }
async function removeFromWishlist(productId) { try { const user = await checkUser(); if(!user) return; const {error} = await window.supabase.from('wishlist').delete().eq('user_id', user.id).eq('product_id', productId); if(error) throw error; CacheManager.clear('wishlist'); return true; } catch(e){ throw e; } }
async function isItemInWishlist(productId) { try { const user = await checkUser(); if(!user) return false; const {data, error} = await window.supabase.from('wishlist').select('id').eq('user_id', user.id).eq('product_id', productId).single(); return !error && data !== null; } catch(e){ return false; } }

// ================================================================
// ORDERS & STOCK DEDUCTION
// ================================================================
async function createOrder(orderData) { try { const user = await checkUser(); if(!user) throw new Error('Not authenticated'); if(!orderData.total || orderData.total <= 0) throw new Error('Invalid order amount'); const cartItems = orderData.items || []; for(const item of cartItems) { const product = await getProductById(item.product_id); if(!product) throw new Error(`Product ${item.name} not found`); if(product.stock < item.quantity) throw new Error(`${item.name}: Only ${product.stock} in stock`); const newStock = product.stock - item.quantity; await updateProduct(item.product_id, {stock: newStock}); } const {data, error} = await window.supabase.from('orders').insert([{user_id: user.id, order_number: `HEF-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`, total: orderData.total, status: 'pending', payment_method: orderData.payment_method || 'paystack', shipping_address: orderData.shipping_address || '', customer_name: orderData.customer_name || '', customer_phone: orderData.customer_phone || '', estimated_delivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), items: cartItems, created_at: new Date().toISOString()}]).select(); if(error) throw error; await clearCart(); await sendOrderConfirmationEmail(user.email, orderData.customer_name, data[0]); return data[0]; } catch(e){ throw e; } }
async function placeOrder(orderData) { try { const user = await checkUser(); if(!user) throw new Error('Not authenticated'); const order = await createOrder(orderData); return order; } catch(e){ throw e; } }
async function getOrders() { try { const user = await checkUser(); if(!user) return []; const {data, error} = await window.supabase.from('orders').select('*').eq('user_id', user.id).order('created_at', {ascending: false}); if(error) throw error; return data || []; } catch(e){ return []; } }
async function getAllOrders() { try { const user = await checkUser(); if(!user) throw new Error('Not authenticated'); const profile = await getUserProfile(); if(!profile.is_admin) throw new Error('Admin required'); const {data, error} = await window.supabase.from('orders').select('*').order('created_at', {ascending: false}); if(error) throw error; return data || []; } catch(e){ return []; } }
async function updateOrderStatus(orderId, status) { try { const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']; if(!validStatuses.includes(status)) throw new Error('Invalid status'); const {data, error} = await window.supabase.from('orders').update({status, updated_at: new Date().toISOString()}).eq('id', orderId).select(); if(error) throw error; return data[0]; } catch(e){ throw e; } }
async function calculateDeliveryEstimate(createdDate) { try { const date = new Date(createdDate); const deliveryDate = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000); return deliveryDate.toISOString(); } catch(e){ return null; } }

// ================================================================
// REVIEWS
// ================================================================
async function addReview(productId, rating, comment) { try { const user = await checkUser(); if(!user) throw new Error('Please login'); if(rating < 1 || rating > 5) throw new Error('Rating 1-5'); const {data, error} = await window.supabase.from('reviews').insert([{product_id: productId, user_id: user.id, rating: parseInt(rating), comment: (comment || '').trim(), created_at: new Date().toISOString()}]).select(); if(error) throw error; CacheManager.clear(`reviews_${productId}`); return data[0]; } catch(e){ throw e; } }
async function getProductReviews(productId) { try { const cacheKey = `reviews_${productId}`; const cached = CacheManager.get(cacheKey); if(cached) return cached; const {data, error} = await window.supabase.from('reviews').select('*').eq('product_id', productId).order('created_at', {ascending: false}); if(error) throw error; CacheManager.set(cacheKey, data); return data || []; } catch(e){ return []; } }
async function getAverageRating(productId) { try { const reviews = await getProductReviews(productId); if(reviews.length === 0) return 0; const total = reviews.reduce((sum, r) => sum + r.rating, 0); return (total / reviews.length).toFixed(1); } catch(e){ return 0; } }

// ================================================================
// PAYMENTS
// ================================================================
async function recordPayment(orderId, paymentData) { try { const {data, error} = await window.supabase.from('payments').insert([{order_id: orderId, amount: paymentData.amount, reference: paymentData.reference, status: 'completed', payment_method: 'paystack', created_at: new Date().toISOString()}]).select(); if(error) throw error; await updateOrderStatus(orderId, 'confirmed'); return data[0]; } catch(e){ throw e; } }

// ================================================================
// NOTIFICATIONS
// ================================================================
async function createNotification(userId, message, type = 'info') { try { const {data, error} = await window.supabase.from('notifications').insert([{user_id: userId, message, type, is_read: false, created_at: new Date().toISOString()}]).select(); if(error) throw error; return data[0]; } catch(e){ throw e; } }
async function getUnreadNotifications() { try { const user = await checkUser(); if(!user) return []; const {data, error} = await window.supabase.from('notifications').select('*').eq('user_id', user.id).eq('is_read', false).order('created_at', {ascending: false}).limit(5); if(error) throw error; return data || []; } catch(e){ return []; } }
async function markAllNotificationsRead() { try { const user = await checkUser(); if(!user) return; const {error} = await window.supabase.from('notifications').update({is_read: true}).eq('user_id', user.id).eq('is_read', false); if(error) throw error; return true; } catch(e){ throw e; } }

// ================================================================
// EMAIL (placeholder for Brevo integration)
// ================================================================
async function sendOrderConfirmationEmail(email, customerName, order) {
    console.log('📧 Email ready for:', email);
    return true;
}

// ================================================================
// UTILITIES
// ================================================================
function validateEmail(email) { const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; return re.test(email); }
function validatePassword(password) { return password && password.length >= 6; }
function formatCurrency(amount) { return '₦' + parseFloat(amount || 0).toLocaleString('en-NG', {maximumFractionDigits: 0}); }
function formatDate(date) { return new Date(date).toLocaleDateString('en-NG', {year: 'numeric', month: 'short', day: 'numeric'}); }

console.log('✅ HOMELY EXQUISITE - BACKEND READY (FULLY FIXED)');
