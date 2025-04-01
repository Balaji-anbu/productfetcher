require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bodyParser = require("body-parser");

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(bodyParser.json());
app.use(cors({
  origin: '*', // In production, replace with your Flutter app's domain
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// MongoDB Connection
const mongoURI = process.env.MONGO_URI;
mongoose.connect(mongoURI, {
  // Connection options can be added here
})
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => {
  console.error("❌ MongoDB Connection Failed:", err);
  process.exit(1); // Exit if database connection fails
});


// ===== PRODUCT SCHEMA & MODEL =====

const productSchema = new mongoose.Schema({
    productId: {
      type: String,
      required: true,
      unique: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    discountedPrice: {
      type: Number,
      min: 0
    },
    category: {
      type: String,
      required: true
    },
    images: [String],
    mainImage: {
      type: String,
      required: true
    },
    inStock: {
      type: Boolean,
      default: true
    },
    quantity: {
      type: Number,
      default: 0,
      min: 0
    },
   
   
    updatedAt: {
      type: Date,
      default: Date.now
    }
  });
  
  // Add text index for search capabilities
  productSchema.index({ name: 'text', description: 'text', tags: 'text' });
  
  // Before saving, update the updatedAt field
  productSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
  });
  
  // Initialize Product model
  const Product = mongoose.model("Product", productSchema);
  





// JWT Secret Key
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "") || req.header("Authorization");
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: "Access denied. No token provided." 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ 
      success: false, 
      message: "Invalid token." 
    });
  }
};

// ===== ROUTES =====

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK',
    timestamp: new Date(),
    service: 'e-mart-backend'
  });
});


// JWT Product Token Generation Endpoint
app.post("/get-product-token", async (req, res) => {
  try {
    // Get the authorization header
    const authHeader = req.header("Authorization");
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: "Authorization token is required" 
      });
    }
    
    // Extract the token
    const authToken = authHeader.replace('Bearer ', '');
    
    try {
      // Verify the existing token
      const decoded = jwt.verify(authToken, JWT_SECRET);
      
      // Generate a new product-specific token with appropriate permissions
      // You can customize the payload based on your needs
      const productTokenPayload = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role || 'user',
        permissions: ['read:products'],
        // Add any other fields you need
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour expiry
      };
      
      // Generate the product token
      const productToken = jwt.sign(productTokenPayload, JWT_SECRET);
      
      // Return the new token
      return res.status(200).json({
        success: true,
        token: productToken,
        expiresIn: 3600 // seconds
      });
      
    } catch (tokenError) {
      // If token verification fails
      return res.status(401).json({ 
        success: false, 
        message: "Invalid authorization token" 
      });
    }
  } catch (error) {
    console.error("Product token generation error:", error);
    return res.status(500).json({
      success: false,
      message: "Error generating product token"
    });
  }
});
  // ===== PRODUCT ROUTES =====

  
  // Get all products with pagination, filtering, and sorting
  app.get("/products", verifyToken, async (req, res) => {
    try {
      // Parsing query parameters
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 1000;
      const skip = (page - 1) * limit;
      
      // Filter parameters
      const category = req.query.category;
      const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice) : undefined;
      const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : undefined;
      const inStock = req.query.inStock === 'true' ? true : undefined;
      const search = req.query.search;
      
      // Sorting
      const sortField = req.query.sortField || 'productId';
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
      
      // Build filter object
      const filter = {};
      
      if (category) filter.category = category;
      if (inStock !== undefined) filter.inStock = inStock;
      
      // Price range
      if (minPrice !== undefined || maxPrice !== undefined) {
        filter.price = {};
        if (minPrice !== undefined) filter.price.$gte = minPrice;
        if (maxPrice !== undefined) filter.price.$lte = maxPrice;
      }
      
      // Text search
      if (search) {
        filter.$text = { $search: search };
      }
      
      // Execute query with pagination and sorting
      const products = await Product.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit);
      
      // Get total count for pagination
      const totalProducts = await Product.countDocuments(filter);
      
      res.json({
        success: true,
        currentPage: page,
        totalPages: Math.ceil(totalProducts / limit),
        totalProducts,
        products
      });
    } catch (error) {
      console.error("Get products error:", error);
      res.status(500).json({
        success: false,
        message: "Error retrieving products"
      });
    }
  });
  
  // Get product by ID
  app.get("/products/:productId", async (req, res) => {
    try {
      const { productId } = req.params;
      
      // Try to find by custom productId first (EGM-PROD-XXXX)
      let product = await Product.findOne({ productId });
      
      // If not found, try to find by MongoDB _id
      if (!product && mongoose.Types.ObjectId.isValid(productId)) {
        product = await Product.findById(productId);
      }
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found"
        });
      }
      
      res.json({
        success: true,
        product
      });
    } catch (error) {
      console.error("Get product error:", error);
      res.status(500).json({
        success: false,
        message: "Error retrieving product"
      });
    }
  });
  
  // Update product (Admin only) - In a real app, add admin middleware
  app.put("/products/:productId", verifyToken, async (req, res) => {
    try {
      const { productId } = req.params;
      const updateData = req.body;
      
      // Remove fields that shouldn't be updated directly
      delete updateData._id;
      delete updateData.productId;
      delete updateData.createdAt;
      
      // Set updatedAt timestamp
      updateData.updatedAt = Date.now();
      
      // Find and update the product
      const product = await Product.findOneAndUpdate(
        { productId },
        { $set: updateData },
        { new: true, runValidators: true }
      );
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found"
        });
      }
      
      res.json({
        success: true,
        message: "Product updated successfully",
        product
      });
    } catch (error) {
      console.error("Update product error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating product"
      });
    }
  });
  
  // Delete product (Admin only) - In a real app, add admin middleware
  app.delete("/products/:productId", verifyToken, async (req, res) => {
    try {
      const { productId } = req.params;
      
      const product = await Product.findOneAndDelete({ productId });
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found"
        });
      }
      
      res.json({
        success: true,
        message: "Product deleted successfully"
      });
    } catch (error) {
      console.error("Delete product error:", error);
      res.status(500).json({
        success: false,
        message: "Error deleting product"
      });
    }
  });
  
  // Get products by category
  app.get("/category/:category/products", async (req, res) => {
    try {
      const { category } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      
      const products = await Product.find({ category })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      
      const totalProducts = await Product.countDocuments({ category });
      
      res.json({
        success: true,
        currentPage: page,
        totalPages: Math.ceil(totalProducts / limit),
        totalProducts,
        products
      });
    } catch (error) {
      console.error("Get products by category error:", error);
      res.status(500).json({
        success: false,
        message: "Error retrieving products by category"
      });
    }
  });
  
  // Search products
  app.get("/search", async (req, res) => {
    try {
      const { q } = req.query;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      
      if (!q) {
        return res.status(400).json({
          success: false,
          message: "Search query is required"
        });
      }
      
      const products = await Product.find(
        { $text: { $search: q } },
        { score: { $meta: "textScore" } }
      )
        .sort({ score: { $meta: "textScore" } })
        .skip(skip)
        .limit(limit);
      
      const totalProducts = await Product.countDocuments({ $text: { $search: q } });
      
      res.json({
        success: true,
        currentPage: page,
        totalPages: Math.ceil(totalProducts / limit),
        totalProducts,
        products
      });
    } catch (error) {
      console.error("Search products error:", error);
      res.status(500).json({
        success: false,
        message: "Error searching products"
      });
    }
  });
  
  // Get featured products (products with highest ratings)
  app.get("/featured-products", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 5;
      
      const products = await Product.find({ inStock: true })
        .sort({ "ratings.average": -1, "ratings.count": -1 })
        .limit(limit);
      
      res.json({
        success: true,
        products
      });
    } catch (error) {
      console.error("Get featured products error:", error);
      res.status(500).json({
        success: false,
        message: "Error retrieving featured products"
      });
    }
  });
  
  // Get new arrivals (most recently added products)
  app.get("/new-arrivals", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 5;
      
      const products = await Product.find({ inStock: true })
        .sort({ createdAt: -1 })
        .limit(limit);
      
      res.json({
        success: true,
        products
      });
    } catch (error) {
      console.error("Get new arrivals error:", error);
      res.status(500).json({
        success: false,
        message: "Error retrieving new arrivals"
      });
    }
  });
  
  // Add product rating and review (requires authentication)
  app.post("/products/:productId/rate", verifyToken, async (req, res) => {
    try {
      const { productId } = req.params;
      const { rating, review } = req.body;
      const userId = req.user.id;
      
      // Validate rating
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({
          success: false,
          message: "Rating must be between 1 and 5"
        });
      }
      
      // Get the product
      const product = await Product.findOne({ productId });
      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found"
        });
      }
      
      // Update product's average rating
      const newCount = product.ratings.count + 1;
      const newAverage = ((product.ratings.average * product.ratings.count) + rating) / newCount;
      
      product.ratings = {
        average: parseFloat(newAverage.toFixed(1)),
        count: newCount
      };
      
      await product.save();
      
      // In a production app, you would save the review to a separate collection
      // with a reference to both the product and user
      
      res.json({
        success: true,
        message: "Rating submitted successfully",
        newRating: product.ratings
      });
    } catch (error) {
      console.error("Rate product error:", error);
      res.status(500).json({
        success: false,
        message: "Error rating product"
      });
    }
  });
  
  // Connect to a different MongoDB instance for product data
  // This assumes you'll set a separate connection string for products
  // In your .env file: MONGO_URI_PRODUCTS=your_connection_string
  
  // Option 1: Use a separate connection for product operations
  const connectProductDB = async () => {
    try {
      const mongoURIProducts = process.env.MONGO_URI_PRODUCTS || process.env.MONGO_URI;
      
      if (!mongoURIProducts) {
        console.error("❌ Product database connection string not found!");
        return;
      }
      
      // If using the same string as main DB, no need for a separate connection
      if (mongoURIProducts === process.env.MONGO_URI) {
        console.log("✅ Using main database for products");
        return;
      }
      
      // For a separate connection
      const productConnection = await mongoose.createConnection(mongoURIProducts);
      console.log("✅ Product Database Connected");
      
      // You would then define your Product model on this connection
      // const Product = productConnection.model("Product", productSchema);
      
    } catch (error) {
      console.error("❌ Product database connection error:", error);
    }
  };
  
  // Option 2: Add this to your server startup code
  // This is simpler if you want to keep everything in one connection
  // but with a different connection string
  
//   // Server startup with product database connection
//   const startServer = async () => {
//     try {
//       // Connect to main database
//       await mongoose.connect(process.env.MONGO_URI);
//       console.log("✅ Main MongoDB Connected");
      
//       // Connect to product database or use the same connection
//       // This function is defined above
//       await connectProductDB();
      
//       // Start server
//       app.listen(port, () => {
//         console.log(`🚀 Server running on port ${port}`);
//       });
//     } catch (err) {
//       console.error("MongoDB Connection Failed:", err);
//       process.exit(1);
//     }
//   };
  
//   startServer();
  
  
// // Global Error Handler
// app.use((err, req, res, next) => {
//     console.error(err.stack);
//     res.status(500).json({ 
//       success: false, 
//       message: 'Something went wrong!' 
//     });
//   });
  
//   // Handle 404 routes
//   app.use((req, res) => {
//     res.status(404).json({ 
//       success: false, 
//       message: 'Route not found' 
//     });
//   });
  
//   // Start server
  app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
  });
