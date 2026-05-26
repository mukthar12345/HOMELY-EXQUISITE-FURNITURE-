// Supabase Configuration
const SUPABASE_URL = 'https://trswmahvppkvpwhtbiyw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyc3dtYWh2cHBrdnB3aHRiaXl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTIwNzAsImV4cCI6MjA5NTEyODA3MH0.fgBA1qFZwn9KEYc78Odwj83j9Pq61igbStRYYNRwywc';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========== AUTH ==========
async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}
async function signUp(email, password, userData) {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: userData } });
    if (error) throw error;
    if (data.user) {
        await supabase.from('profiles').insert([{ id: data.user.id, email, full_name: userData.full_name, phone: userData.phone, is_admin: false }]);
    }
    return data;
}
async function logIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}
async function logOut() { await supabase.auth.signOut(); window.location.href = 'login.html'; }
async function getUserProfile() {
    const user = await checkUser();
    if (!user) return null;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    return data;
}
async function isAdmin() {
    const profile = await getUserProfile();
    return profile?.is_admin === true;
}

// ========== CART ==========
async function addToCart(productId, quantity = 1) {
    const user = await checkUser();
    if (!user) { alert('Please login'); window.location.href = 'login.html'; return false; }
    const { data: existing } = await supabase.from('cart').select('*').eq('user_id', user.id).eq('product_id', productId).single();
    if (existing) {
        await supabase.from('cart').update({ quantity: existing.quantity + quantity }).eq('id', existing.id);
    } else {
        await supabase.from('cart').insert([{ user_id: user.id, product_id: productId, quantity }]);
    }
    return true;
}
async function getCart() {
    const user = await checkUser();
    if (!user) return [];
    const { data } = await supabase.from('cart').select(`*, products(*)`).eq('user_id', user.id);
    return data || [];
}
async function updateCartItem(cartId, quantity) { await supabase.from('cart').update({ quantity }).eq('id', cartId); }
async function removeCartItem(cartId) { await supabase.from('cart').delete().eq('id', cartId); }
async function getCartCount() {
    const cart = await getCart();
    return cart.reduce((sum, item) => sum + item.quantity, 0);
}

// ========== ORDERS (with delivery estimate) ==========
function calculateDeliveryEstimate(address) {
    const lower = address.toLowerCase();
    if (lower.includes('lagos') || lower.includes('ikeja') || lower.includes('magboro') || lower.includes('oke afa') || lower.includes('ogun')) {
        return { min: 2, max: 3, unit: 'days' };
    } else if (lower.includes('abuja') || lower.includes('kano') || lower.includes('port harcourt')) {
        return { min: 4, max: 6, unit: 'days' };
    } else {
        return { min: 5, max: 7, unit: 'days' };
    }
}

async function placeOrder(orderData) {
    const user = await checkUser();
    if (!user) throw new Error('Not logged in');
    const cart = await getCart();
    if (cart.length === 0) throw new Error('Cart empty');
    const subtotal = cart.reduce((sum, item) => sum + (item.products.price * item.quantity), 0);
    const deliveryFee = 5000;
    const total = subtotal + deliveryFee;
    const orderNumber = 'HEF-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const deliveryEstimate = calculateDeliveryEstimate(orderData.address);
    const estimatedDelivery = `${deliveryEstimate.min}-${deliveryEstimate.max} ${deliveryEstimate.unit}`;
    const { data: order, error: orderError } = await supabase.from('orders').insert([{
        order_number: orderNumber,
        user_id: user.id,
        total: total,
        status: 'pending',
        payment_method: orderData.paymentMethod,
        shipping_address: orderData.address,
        customer_name: orderData.fullName,
        customer_phone: orderData.phone,
        estimated_delivery: estimatedDelivery
    }]).select().single();
    if (orderError) throw orderError;
    for (let item of cart) {
        await supabase.from('order_items').insert([{ order_id: order.id, product_id: item.product_id, quantity: item.quantity, price: item.products.price }]);
    }
    // Create notification for CEO
    await supabase.from('notifications').insert([{
        order_id: order.id,
        message: `New order #${orderNumber} from ${orderData.fullName}`,
        is_read: false,
        created_at: new Date()
    }]);
    await supabase.from('cart').delete().eq('user_id', user.id);
    return { order, estimatedDelivery };
}

async function getUserOrders() {
    const user = await checkUser();
    if (!user) return [];
    const { data } = await supabase.from('orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    return data || [];
}
async function getAllOrdersForAdmin() {
    const admin = await isAdmin();
    if (!admin) return [];
    const { data } = await supabase.from('orders').select('*, profiles(full_name, email)').order('created_at', { ascending: false });
    return data || [];
}
async function updateOrderStatus(orderId, status) {
    const admin = await isAdmin();
    if (!admin) throw new Error('Unauthorized');
    await supabase.from('orders').update({ status }).eq('id', orderId);
}

// ========== NOTIFICATIONS (CEO only) ==========
async function getUnreadNotifications() {
    const admin = await isAdmin();
    if (!admin) return [];
    const { data } = await supabase.from('notifications').select('*').eq('is_read', false).order('created_at', { ascending: false });
    return data || [];
}
async function markNotificationRead(id) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
}
async function markAllNotificationsRead() {
    await supabase.from('notifications').update({ is_read: true }).neq('is_read', true);
}

// ========== PRODUCTS (CEO only for write) ==========
async function getProducts(category = 'all') {
    let query = supabase.from('products').select('*');
    if (category !== 'all') query = query.eq('category', category);
    const { data } = await query.order('created_at', { ascending: false });
    return data || [];
}
async function getProduct(id) {
    const { data } = await supabase.from('products').select('*').eq('id', id).single();
    return data;
}
async function addProduct(productData) {
    const admin = await isAdmin();
    if (!admin) throw new Error('Unauthorized');
    const { error } = await supabase.from('products').insert([productData]);
    if (error) throw error;
}
async function deleteProduct(productId) {
    const admin = await isAdmin();
    if (!admin) throw new Error('Unauthorized');
    await supabase.from('products').delete().eq('id', productId);
}

// ========== WISHLIST ==========
async function addToWishlist(productId) {
    const user = await checkUser();
    if (!user) { alert('Please login'); return; }
    await supabase.from('wishlist').insert([{ user_id: user.id, product_id: productId }]);
}
async function getWishlist() {
    const user = await checkUser();
    if (!user) return [];
    const { data } = await supabase.from('wishlist').select(`*, products(*)`).eq('user_id', user.id);
    return data || [];
}
async function removeFromWishlist(productId) {
    const user = await checkUser();
    if (!user) return;
    await supabase.from(// Supabase Configuration
const SUPABASE_URL = 'https://trswmahvppkvpwhtbiyw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyc3dtYWh2cHBrdnB3aHRiaXl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTIwNzAsImV4cCI6MjA5NTEyODA3MH0.fgBA1qFZwn9KEYc78Odwj83j9Pq61igbStRYYNRwywc';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========== AUTH ==========
async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}
async function signUp(email, password, userData) {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: userData } });
    if (error) throw error;
    if (data.user) {
        await supabase.from('profiles').insert([{ id: data.user.id, email, full_name: userData.full_name, phone: userData.phone, is_admin: false }]);
    }
    return data;
}
async function logIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}
async function logOut() { await supabase.auth.signOut(); window.location.href = 'login.html'; }
async function getUserProfile() {
    const user = await checkUser();
    if (!user) return null;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    return data;
}
async function isAdmin() {
    const profile = await getUserProfile();
    return profile?.is_admin === true;
}

// ========== CART ==========
async function addToCart(productId, quantity = 1) {
    const user = await checkUser();
    if (!user) { alert('Please login'); window.location.href = 'login.html'; return false; }
    const { data: existing } = await supabase.from('cart').select('*').eq('user_id', user.id).eq('product_id', productId).single();
    if (existing) {
        await supabase.from('cart').update({ quantity: existing.quantity + quantity }).eq('id', existing.id);
    } else {
        await supabase.from('cart').insert([{ user_id: user.id, product_id: productId, quantity }]);
    }
    return true;
}
async function getCart() {
    const user = await checkUser();
    if (!user) return [];
    const { data } = await supabase.from('cart').select(`*, products(*)`).eq('user_id', user.id);
    return data || [];
}
async function updateCartItem(cartId, quantity) { await supabase.from('cart').update({ quantity }).eq('id', cartId); }
async function removeCartItem(cartId) { await supabase.from('cart').delete().eq('id', cartId); }
async function getCartCount() {
    const cart = await getCart();
    return cart.reduce((sum, item) => sum + item.quantity, 0);
}

// ========== ORDERS (with delivery estimate) ==========
function calculateDeliveryEstimate(address) {
    const lower = address.toLowerCase();
    if (lower.includes('lagos') || lower.includes('ikeja') || lower.includes('magboro') || lower.includes('oke afa') || lower.includes('ogun')) {
        return { min: 2, max: 3, unit: 'days' };
    } else if (lower.includes('abuja') || lower.includes('kano') || lower.includes('port harcourt')) {
        return { min: 4, max: 6, unit: 'days' };
    } else {
        return { min: 5, max: 7, unit: 'days' };
    }
}

async function placeOrder(orderData) {
    const user = await checkUser();
    if (!user) throw new Error('Not logged in');
    const cart = await getCart();
    if (cart.length === 0) throw new Error('Cart empty');
    const subtotal = cart.reduce((sum, item) => sum + (item.products.price * item.quantity), 0);
    const deliveryFee = 5000;
    const total = subtotal + deliveryFee;
    const orderNumber = 'HEF-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const deliveryEstimate = calculateDeliveryEstimate(orderData.address);
    const estimatedDelivery = `${deliveryEstimate.min}-${deliveryEstimate.max} ${deliveryEstimate.unit}`;
    const { data: order, error: orderError } = await supabase.from('orders').insert([{
        order_number: orderNumber,
        user_id: user.id,
        total: total,
        status: 'pending',
        payment_method: orderData.paymentMethod,
        shipping_address: orderData.address,
        customer_name: orderData.fullName,
        customer_phone: orderData.phone,
        estimated_delivery: estimatedDelivery
    }]).select().single();
    if (orderError) throw orderError;
    for (let item of cart) {
        await supabase.from('order_items').insert([{ order_id: order.id, product_id: item.product_id, quantity: item.quantity, price: item.products.price }]);
    }
    // Create notification for CEO
    await supabase.from('notifications').insert([{
        order_id: order.id,
        message: `New order #${orderNumber} from ${orderData.fullName}`,
        is_read: false,
        created_at: new Date()
    }]);
    await supabase.from('cart').delete().eq('user_id', user.id);
    return { order, estimatedDelivery };
}

async function getUserOrders() {
    const user = await checkUser();
    if (!user) return [];
    const { data } = await supabase.from('orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    return data || [];
}
async function getAllOrdersForAdmin() {
    const admin = await isAdmin();
    if (!admin) return [];
    const { data } = await supabase.from('orders').select('*, profiles(full_name, email)').order('created_at', { ascending: false });
    return data || [];
}
async function updateOrderStatus(orderId, status) {
    const admin = await isAdmin();
    if (!admin) throw new Error('Unauthorized');
    await supabase.from('orders').update({ status }).eq('id', orderId);
}

// ========== NOTIFICATIONS (CEO only) ==========
async function getUnreadNotifications() {
    const admin = await isAdmin();
    if (!admin) return [];
    const { data } = await supabase.from('notifications').select('*').eq('is_read', false).order('created_at', { ascending: false });
    return data || [];
}
async function markNotificationRead(id) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
}
async function markAllNotificationsRead() {
    await supabase.from('notifications').update({ is_read: true }).neq('is_read', true);
}

// ========== PRODUCTS (CEO only for write) ==========
async function getProducts(category = 'all') {
    let query = supabase.from('products').select('*');
    if (category !== 'all') query = query.eq('category', category);
    const { data } = await query.order('created_at', { ascending: false });
    return data || [];
}
async function getProduct(id) {
    const { data } = await supabase.from('products').select('*').eq('id', id).single();
    return data;
}
async function addProduct(productData) {
    const admin = await isAdmin();
    if (!admin) throw new Error('Unauthorized');
    const { error } = await supabase.from('products').insert([productData]);
    if (error) throw error;
}
async function deleteProduct(productId) {
    const admin = await isAdmin();
    if (!admin) throw new Error('Unauthorized');
    await supabase.from('products').delete().eq('id', productId);
}

// ========== WISHLIST ==========
async function addToWishlist(productId) {
    const user = await checkUser();
    if (!user) { alert('Please login'); return; }
    await supabase.from('wishlist').insert([{ user_id: user.id, product_id: productId }]);
}
async function getWishlist() {
    const user = await checkUser();
    if (!user) return [];
    const { data } = await supabase.from('wishlist').select(`*, products(*)`).eq('user_id', user.id);
    return data || [];
}
async function removeFromWishlist(productId) {
    const user = await checkUser();
    if (!user) return;
    await supabase.from('wishlist').delete().eq('user_id', user.id).eq('product_id', productId);
}

// ========== REVIEWS ==========
async function addReview(productId, rating, comment) {
    const user = await checkUser();
    if (!user) { alert('Please login'); return false; }
    await supabase.from('reviews').insert([{ product_id: productId, user_id: user.id, rating, comment }]);
    return true;
}
async function getProductReviews(productId) {
    const { data } = await supabase.from('reviews').select(`*, profiles(full_name)`).eq('product_id', productId).order('created_at', { ascending: false });
    return data || [];
}

// ========== HELPER ==========
async function updateCartCountDisplay() {
    const count = await getCartCount();
    const badge = document.getElementById('cartCount');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
}).delete().eq('user_id', user.id).eq('product_id', productId);
}

// ========== REVIEWS ==========
async function addReview(productId, rating, comment) {
    const user = await checkUser();
    if (!user) { alert('Please login'); return false; }
    await supabase.from('reviews').insert([{ product_id: productId, user_id: user.id, rating, comment }]);
    return true;
}
async function getProductReviews(productId) {
    const { data } = await supabase.from('reviews').select(`*, profiles(full_name)`).eq('product_id', productId).order('created_at', { ascending: false });
    return data || [];
}

// ========== HELPER ==========
async function updateCartCountDisplay() {
    const count = await getCartCount();
    const badge = document.getElementById('cartCount');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
}